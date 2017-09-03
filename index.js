var fs = require('fs');

var express = require('express')
var bodyParser = require('body-parser')

var tus = require('tus-node-server')
var server = new tus.Server()
var Uid = require('tus-node-server/lib/models/Uid')

var ipfsAPI = require('ipfs-api')
var ipfs = ipfsAPI({host: 'localhost', port: '5001', protocol: 'http'})

var rimraf = require('rimraf')

var files = [];
var ipfsStatus = [];
var dataFile = __dirname + '/data.json';

if (fs.existsSync(dataFile)){
	files = JSON.parse(fs.readFileSync(dataFile)).files;
	ipfsStatus = JSON.parse(fs.readFileSync(dataFile)).ipfsStatus;
} else {
	fs.writeFile(dataFile, '{"files":[], "ipfsStatus: []"}');
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

	ipfsStatus.push({"id": id, "ids": ids, "status": "not_started"});

	res.send({"id": id, "ids": ids, "status": "not_started"});
})

app.get('/check/:id', function(req, res){
	var matched = false;
	for (var i = 0; i < ipfsStatus.length; i++) {
		if (req.params.id === ipfsStatus[i].id){
			matched = true;
			res.send(ipfsStatus[i]);
		}
	}
	if (!matched){
		res.send({id: req.params.id});
	}
})

var port = 11945;
var host = "localhost"

app.listen(port, host);
console.log("Started ipfs-tus-uploader on " + host + ":" + port);

var writeDataFile = function(){
	fs.writeFileSync(dataFile, JSON.stringify({"files": files, "ipfsStatus": ipfsStatus}, null, 4));
}

// Every 5 minutes save file.
setInterval(function(){
	writeDataFile();
}, 5 * 60 * 1000)

var processIPFS = function(callback){
	var cbCalled = false;

	for (var i = 0; i < ipfsStatus.length; i++) {
		if (ipfsStatus[i].status === "not_started" || ipfsStatus[i].status === "ipfs_directory_create_fail"){
			ipfsStatus[i].status = "ipfs_directory_create_start";
			// Make the directory
			makeIPFSDirectory(i);
		} else if (ipfsStatus[i].status === "ipfs_directory_create_complete" || ipfsStatus[i].status === "ipfs_file_copy_start" || ipfsStatus[i].status === "ipfs_file_copy_inprogress") {
			ipfsStatus[i].status = "ipfs_file_copy_start";
			// Move the files into place.
			copyFilesToIPFSDirectory(i);
		} else if (ipfsStatus[i].status === "ipfs_file_copy_complete" || ipfsStatus[i].status === "ipfs_file_add_retry"){
			ipfsStatus[i].status = "ipfs_file_add_start";
			addFilesToIPFS(i);
		} else if (ipfsStatus[i].status === "ipfs_file_add_start" || ipfsStatus[i].status === "ipfs_file_add_success" || ipfsStatus[i].status === "ipfs_file_add_error" || ipfsStatus[i].status === "ipfs_add_check_error"){
			checkIPFSaddStatus(i);
		}

		// Cleanup the dir since the add was successful.
		//rimraf(__dirname + '/ipfs/' + id + '/', function(){});
	}
}

var makeIPFSDirectory = function(ipfsNum){
	if (!fs.existsSync(__dirname + '/ipfs/')){
		fs.mkdirSync(__dirname + '/ipfs/');
	}

	if (fs.existsSync(__dirname + '/ipfs/' + ipfsStatus[ipfsNum].id)){
		ipfsStatus[ipfsNum].status = "ipfs_directory_create_complete";
	} else {
		fs.mkdir(__dirname + '/ipfs/' + ipfsStatus[ipfsNum].id, function(err){
			if (err){
				console.log(err);
				ipfsStatus[ipfsNum].status = "ipfs_directory_create_fail";
				return;
			}

			ipfsStatus[ipfsNum].status = "ipfs_directory_create_complete";
		})
	}
}

var copyFilesToIPFSDirectory = function(ipfsNum){
	var allAdded = true;
	for (var i = 0; i < ipfsStatus[ipfsNum].ids.length; i++) {
		if (!ipfsStatus[ipfsNum].ids[i])
			continue;

		var match = false;
		for (var j = 0; j < files.length; j++) {
			if (files[j].id == ipfsStatus[ipfsNum].ids[i]){
				match = true;
				if (fs.existsSync(__dirname + '/files/' + ipfsStatus[ipfsNum].ids[i])){
					var decodedName = new Buffer(files[j].name, 'base64').toString('ascii');
					
					// If we have already copied the file, move on.
					var mainStat = fs.statSync(__dirname + '/files/' + ipfsStatus[ipfsNum].ids[i]);
					var copyStat = fs.statSync(__dirname + '/ipfs/' + ipfsStatus[ipfsNum].id + '/' + decodedName);
					if (mainstats.size === copystats.size){
						continue;
					} else {
						allAdded = false;
						ipfsStatus[ipfsNum].status = "ipfs_file_copy_inprogress";

						copyFile(__dirname + '/files/' + ipfsStatus[ipfsNum].ids[i], __dirname + '/ipfs/' + ipfsStatus[ipfsNum].id + '/' + decodedName, function(err){
							if (err){
								console.log(err);
								ipfsStatus[ipfsNum].status = "ipfs_file_copy_error";
							}
						});
					}
				} else {
					//res.send("File does not exist! "+ ipfsStatus[ipfsNum].ids[i])
					console.log("File does not exist! "+ ipfsStatus[ipfsNum].ids[i]);
					ipfsStatus[ipfsNum].status = "ipfs_file_does_not_exist";
				}
			}
		}

		if (!match){
			allAdded = false;
		}
	}

	if (allAdded){
		ipfsStatus[ipfsNum].status = "ipfs_file_copy_complete";
	}
}

var copyFile = function (source, target, cb) {
	var cbCalled = false;

	function done(err) {
		if (!cbCalled) {
			cb(err);
			cbCalled = true;
		}
	}

	var rd = fs.createReadStream(source);

	rd.on("error", function(err) {
		done(err);
	});

	var wr = fs.createWriteStream(target);

	wr.on("error", function(err) {
		done(err);
	});

	wr.on("close", function(ex) {
		done();
	});

	rd.pipe(wr);
}

var addFilesToIPFS = function(ipfsNum){
	ipfsStatus[ipfsNum].status = "ipfs_file_add_inprogress";
	ipfs.util.addFromFs(__dirname + '/ipfs/' + ipfsStatus[ipfsNum].id + '/', {recursive: true}, (err, result) => {
		if (err){
			console.log(err);
			ipfsStatus[ipfsNum].status = "ipfs_file_add_error";
			return;
		}

		if (!result || result === [] || !result[result.length - 1] || !result[result.length - 1].hash){
			ipfsStatus[ipfsNum].status = "ipfs_file_add_retry";
			return;
		}

		ipfsStatus[ipfsNum].ipfsResponse = result;
		ipfsStatus[ipfsNum].mainHash = result[result.length - 1].hash;

		ipfsStatus[ipfsNum].status = "ipfs_file_add_success";
	})
}

var checkIPFSaddStatus = function(ipfsNum){
	if (!ipfsStatus[ipfsNum] || !ipfsStatus[ipfsNum].mainHash){
		if (ipfsStatus[ipfsNum].status === "ipfs_file_add_error"){
			ipfsStatus[ipfsNum].status = "ipfs_file_add_retry";
		}
		return;
	}

	ipfs.object.links(ipfsStatus[ipfsNum].mainHash, {enc: "base58"}, function(err, result){
		if (err){
			ipfsStatus[ipfsNum].status = "ipfs_add_check_error";
			console.log(err);
			return;
		}

		var allAdded = true;
		for (var k = 0; k < result.length; k++) {
			var matched = false;
			for (var i = 0; i < ipfsStatus[ipfsNum].ids.length; i++) {
				for (var j = 0; j < files.length; j++) {
					if (files[j].id == ipfsStatus[ipfsNum].ids[i]){
						var decodedName = new Buffer(files[j].name, 'base64').toString('ascii');
					
						if(decodedName === result[k]._name){
							matched = true;
						}
					}
				}	
			}

			if (!matched){
				allAdded = false;
				console.log("File not added for: " + result[k]._name);
			}
		}

		if (allAdded){
			ipfsStatus[ipfsNum].status = "ipfs_file_check_complete";
		} else {
			ipfsStatus[ipfsNum].status = "ipfs_file_add_retry";
		}
	});
}

// Process IPFS every 1 second
var processIPFSTimeout = setInterval(function(){
	processIPFS();
}, 1 * 1000)

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