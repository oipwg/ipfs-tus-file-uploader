var fs = require('fs');

var express = require('express')
var bodyParser = require('body-parser')

var tus = require('tus-node-server')
var server = new tus.Server()
var Uid = require('tus-node-server/lib/models/Uid')

var ipfsAPI = require('ipfs-api')
var ipfs = ipfsAPI({host: 'localhost', port: '5001', protocol: 'http'})

var rimraf = require('rimraf')

var files = []
var dataFile = __dirname + '/data.json';

if (fs.existsSync(dataFile)){
	files = JSON.parse(fs.readFileSync(dataFile)).files;
} else {
	fs.writeFile(dataFile, '{"files":[]}');
}

const fileNameFromUrl = (req) => {
	var id = Uid.rand()
	files.push({id: id, name: req.headers['upload-metadata'].split(' ')[1]})
    return id
}

server.datastore = new tus.FileStore({
    path: '/files',
    namingFunction: fileNameFromUrl
})

var app = express();

app.use(bodyParser.json());

// Add headers
app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Pass to next layer of middleware
    next();
});

app.all('/files/*', function(req, res) {
	server.handle(req, res)
})

app.post('/addToIPFS', function(req, res){
	// move to folder, change files name back to normal, add folder to IPFS
	if (!req.body || !req.body.fileids){
		res.send("Error, please include POST data.");
		return;
	}

	var ids = req.body.fileids;

	if (!ids.length || ids.length == 0){
		res.send("Please submit ids to add to IPFS!");
		return;
	}

	// Get a new Uid for a folder name.
	var id = Uid.rand();

	// Make the directory
	fs.mkdir(__dirname + '/ipfs/' + id, function(err){
		if (err){
			console.log(err);
			return;
		}

		// Move the files into place.
		for (var i = 0; i < ids.length; i++) {
			for (var j = 0; j < files.length; j++) {
				if (files[j].id == ids[i]){
					if (fs.existsSync(__dirname + '/files/' + ids[i])){
						var decodedName = new Buffer(files[j].name, 'base64').toString('ascii');
						console.log(decodedName);
						fs.renameSync(__dirname + '/files/' + ids[i], __dirname + '/ipfs/' + id + '/' + decodedName);
					} else {
						res.send("File does not exist! "+ ids[i])
						console.log("File does not exist! "+ ids[i])
					}
				}
			}	
		}

		// Add the folder to IPFS
		ipfs.util.addFromFs(__dirname + '/ipfs/' + id + '/', {recursive: true}, (err, result) => {
			if (err){
				res.send("Error adding to IPFS, please try again later...")
				console.log(err)
				return 
			}

			res.send(result);

			// Cleanup the dir since the add was successful.
			rimraf(__dirname + '/ipfs/' + id + '/', function(){});
		})
	})

	// Move the files matching the ID's into the directory

	// rename files to original

	// Add into IPFS
	/*ipfs.util.addFromFs('/files/' + id, {recursive: true}, (err, result) => {
		if (err){
			return console.log(err)
		}

		console.log(result);
	})*/
})

var port = 11945;
var host = "localhost"

app.listen(port, host);

var writeDataFile = function(){
	fs.writeFileSync(dataFile, JSON.stringify({"files": files}, null, 4));
}

// Every 5 minutes save file.
setTimeout(function(){
	writeDataFile();
}, 5 * 60 * 1000)

process.stdin.resume()//so the program will not close instantly

function exitHandler (options, err) {
	writeDataFile();
	if (err) console.log(err.stack)
	if (options.exit) process.exit()
}

//do something when app is closing
process.on('exit', exitHandler.bind(null, {cleanup: true}))

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit: true}))

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit: true}))