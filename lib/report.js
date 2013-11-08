var asana   = require('asana-api')
  , async   = require('async')
  , fs      = require('fs')
  , Github  = require('github')
  , HipChat = require('hipchatter')
  , needle  = require('needle')
  , path    = require('path');

module.exports = Report;

function Report(message, options) {
  this.message = message;
  this.options = options;
  this.hipchat = new HipChat(options.keys.hipchat);
  this.github = new Github({
    version: '3.0.0',
    debug: false
  });
  this.github.authenticate({
    type: "oauth",
    token: options.keys.github
  });
  if (options.keys.asana) {
    this.asana = asana.createClient({ apiKey: options.keys.asana });
  }
};

Report.version = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'))
).version;

Report.prototype.latestCommitsJSON = function(done) {
  var commits = [];
  var repos = this.options.repos;
  this.github.events.getFromUser({ user: 'alexmingoia' }, function(err, res) {
    if (err) return done(err);
    res.forEach(function(event) {
      var created = new Date(event.created_at);
      var yesterday = new Date().setDate(new Date().getDate() - 1);
      if (created < yesterday) return;
      if (event.type != 'PushEvent') return;
      if (!event.payload.commits || !event.payload.commits.length) return;
      if (repos && !~repos.indexOf(event.repo.name)) return;
      event.payload.commits.forEach(function(commit) {
        commits.push({
          repo: event.repo,
          message: commit.message,
          url: commit.url,
          sha: commit.sha
        });
      });
    });
    done(null, commits);
  });
  return this;
};

Report.prototype.latestCommitsHTML = function(done) {
  this.latestCommitsJSON(function(err, commits) {
    if (err) return done(err);
    var html = "<ul>";
    commits.forEach(function(commit) {
      html +=
        '<li>' +
          commit.message + ' (' + commit.repo.name + ' ' +
          '<a href="' + commit.url + '">' + commit.sha.substr(0, 6) + '</a>)' +
        '</li>';
    });
    html += '</ul>';
    done(null, html);
  });
  return this;
};

Report.prototype.asanaProjectIds = function(done) {
  if (this.options.projects) return done(null, this.options.projects);
  var projectIds = [];
  this.asana.projects.list(function(err, projects) {
    if (err) return done(err);
    projects.forEach(function(project) {
      projectIds.push(project.id);
    });
    done(null, projectIds);
  });
};

Report.prototype.nextDueTask = function(done) {
  var asana = this.asana;
  async.waterfall([
    this.asanaProjectIds.bind(this),
    function(projectIds, next) {
      asana.users.me(function(err, user) {
        if (err) return next(err);
        next(null, projectIds, user.id);
      });
    },
    function(projectIds, userId, next) {
      var tasks = [];
      async.each(projectIds, function(projectId, cont) {
        asana.request(
          '/tasks?project=' + projectId +
          '&opt_fields=id,name,completed,due_on,assignee',
          function(err, result) {
            if (err) return cont(err);
            tasks = tasks.concat(result);
            cont();
          }
        );
      }, function(err) {
        if (err) return next(err);
        next(null, userId, tasks);
      });
    }
  ], function(err, userId, tasks) {
    if (err) return done(err);
    var myTasks = [];
    tasks.forEach(function(task) {
      if (!task.completed && task.assignee && task.assignee.id == userId) {
        myTasks.push(task);
      }
    });
    myTasks.sort(function(a, b) {
      a = new Date(a.due_on);
      b = new Date(b.due_on);
      return a<b?-1:a>b?1:0;
    });
    done(null, myTasks.pop());
  });
};

Report.prototype.prepareMessage = function(done) {
  if (this.message) return done(null, this.message);
  this.nextDueTask(function(err, task) {
    if (err) return done(err);
    done(null, "Today I'm working on " + task.name + '.');
  });
};

Report.prototype.send = function(done) {
  var hipchat = this.hipchat;
  var roomId = this.options.room;
  this.prepareMessage(function(err, message) {
    if (err) return done(err);
    this.latestCommitsHTML(function(err, html) {
      if (err) return done(err);
      html = '<p>' + message + " Since yesterday I've done:</p>" + html;
      needle.post(
        hipchat.url('/room/' + roomId + '/message'),
        { message_format: 'html', message: html },
        { json: true },
        function(err, res, body) {
          if (err) return done(err);
          done(null, body);
        }
      );
    });
  }.bind(this));
  return this;
};
