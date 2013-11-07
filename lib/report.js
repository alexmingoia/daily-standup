var fs      = require('fs')
  , Github  = require('github')
  , HipChat = require('hipchatter')
  , needle  = require('needle')
  , path    = require('path');

module.exports = Report;

function Report(message, options) {
  this.message = message;
  this.keys = options.keys;
  this.roomId = options.room;
  this.hipchat = new HipChat(options.keys.hipchat);
  this.github = new Github({
    version: '3.0.0',
    debug: false
  });
  this.github.authenticate({
    type: "oauth",
    token: options.keys.github
  });
};

Report.version = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'))
).version;

Report.prototype.latestCommitsJSON = function(done) {
  var commits = [];
  this.github.events.getFromUser({ user: 'alexmingoia' }, function(err, res) {
    if (err) return done(err);
    res.forEach(function(event) {
      var created = new Date(event.created_at);
      var yesterday = new Date().setDate(new Date().getDate() - 1);
      if (created < yesterday) return;
      if (event.type != 'PushEvent') return;
      if (!event.payload.commits || !event.payload.commits.length) return;
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
    var html = "<p>Since yesterday I've done:</p><ul>";
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

Report.prototype.send = function(done) {
  var message = this.message;
  var hipchat = this.hipchat;
  var roomId = this.roomId;
  this.latestCommitsHTML(function(err, html) {
    if (err) return done(err);
    html = '<p>' + message + '</p>' + html;
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
  return this;
};
