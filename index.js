'use-strict';

const restify = require('restify');
const fs = require('fs');
const bs58 = require('bs58');
const assert = require('assert');
const urlsCollection = 'urls';

var MongoClient = require('mongodb').MongoClient

var port = Number(process.env.PORT) | 3000;

var mongoUrl = process.env.MONGO_URL;
var db;


/**
 * Generate a random base58 Id for the link. Retry if it already exists
 */
function genNewId(cb, attempt, length) {
  attempt = attempt || 0;
  length = length || 7;

  var randomId = bs58.encode(Math.random().toString())
  
  randomId = randomId.substring(0, length);

  // Check if Id already exists
  db.collection(urlsCollection).findOne(
    {id: randomId},
    function(err, item) {

      if (item) {
        console.log('Id exists: ' + randomId);
        attempt++;

        if (attempt >= 10) {
          length++;
        }

        genNewId(cb, attempt, length);
        return;
      }

      if (cb && typeof(cb) === 'function') {
        cb(randomId);
      }
    });
}


/**
 * Index view
 */
function index(req, res, cb) {

  fs.readFile('./index.html', 'utf8', function(err, file) {
    if (err) {
      res.send(500, {error: true, message: 'Could not read home'});
      return cb();
    }

    res.write(
      file
      .replace(
        /{{host}}/g,
        req.isSecure() ? 'https' : 'http' + '://' + req.headers.host)
    );

    res.end();

    return cb();
  });
}


/**
 * New shortened link parser view
 */
function newShortenedLink(req, res, cb) {

  var host = req.isSecure() ? 'https' : 'http' + '://' + req.headers.host
  var url = req.url.replace(/^\/new\//, '');

  db.collection(urlsCollection).findOne(
    {originalUrl: url},
    function(err, item) {
      var data;

      if (item) {
        data = {
          original_url: item.originalUrl,
          short_url: host + '/' + item.id
        }
        console.log('URL already shortened ' + url);
        return res.send(data);
      }

      // Generate a 
      genNewId(function(shortId) {
        var data = {
          original_url: url,
          short_url: host + '/' + shortId
        };

        db.collection(urlsCollection).insertOne({
          originalUrl: url,
          id: shortId
        });
        console.log('Created ' + shortId + ' for ' + url);
        res.send(data);

        if (cb && typeof(cb) === 'function') {
          cb();
        }
      });
  });
}

/**
 * Resolve previously shortened URL 
 */
function resolveShortened(req, res, cb) {

  db.collection(urlsCollection).findOne(
    {id: req.params.shortId},
    function(err, item) {
      if (err) {
        return res.send(500, {error: true, message: 'Could not retrieve link'});
      }
      if (!item) {
        return res.send(404, {error: true, message: 'Link not found'});
      }
      console.log('Link found ' + item.id + ' => ' + item.originalUrl);

      var link = item.originalUrl.match(/^https?:\/\//) ?
                 item.originalUrl : 'http://' + item.originalUrl;
              
      res.redirect(302, link, cb);
    });
}

// Initialize server
var server = restify.createServer();

// Routes
server.get('/', index);
server.get('/:shortId', resolveShortened);
server.get('/.*', resolveShortened);
server.get('/new/.*', newShortenedLink);

// Connect to database
MongoClient.connect(mongoUrl, function(err, client) {
  assert.equal(null, err);
  console.log("Connected successfully to database");
  db = client;
  
  // Listen on available port
  server
    .on('error', function(error) {
      if (error.errno === 'EADDRINUSE') {
        console.log('Port ' + port  + ' already in use, trying another port');
        port += 1;
        this.listen(port);
      } else {
        throw error;
      }
    })
    .listen(port, function() {
      console.log('Server running on port ' + port);
    });
});

module.exports = server;
