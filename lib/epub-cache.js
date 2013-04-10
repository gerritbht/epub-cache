
var converter = require('epub2html');
var fs = require('fs');
var crypto = require('crypto');
var db = {};
var mkdirp = require('mkdirp');
var FileQueue = require('filequeue');

var cacheDir, epubdb={}, epubdbPath;
var idLimit = 100;

// the filter chain idea may get deprecated
// it seems better suited for higher in the stack
// such as at the controller level of an application
// when the response can be modified on its way out the door

var filters = [
	function (filename, data) {
		return data;
	}
];

function getUid() {
	var current_date = (new Date()).valueOf().toString();
	var random = Math.random().toString();
	return crypto.createHash('sha1').update(current_date + random).digest('hex');
}

function getHashId() {
	//stub
}

function basePath(id) {
	return cacheDir +'/' + id + '/';
}

function runFilterChain(filename, data) {
	for(var i = 0; i < filters.length; i++) {
		data = filters[i].apply(this, [filename, data]);
	}
	return data;
}

function getPathJson(cacheId) {
	return cacheDir+'/'+cacheId+'.json';
}

module.exports.init = function init(config) {
	cacheDir = config.cacheDir || cacheDir;
	idLimit = config.idLimit || idLimit;
}

module.exports.has = function has (id, cb) {
	if(typeof arguments[1]==='function') {
		fs.exists(basePath(id), cb);
	} else {
		return fs.existsSync(basePath(id));
	}
}

module.exports.clear = function clear() {
	var rmDir = function(dirPath) {
    try {
    	var files = fs.readdirSync(dirPath);
    }	catch(e) { 
    	return; 
    }
    if (files.length > 0) {
      for (var i = 0; i < files.length; i++) {
        var filePath = dirPath + '/' + files[i];
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        } else {
          rmDir(filePath);
        }
			}
  	}
  	fs.rmdirSync(dirPath);
	};
	try { 
		var files = fs.readdirSync(cacheDir); 
	}	catch(e) { 
		return; 
	}
	if (files.length > 0) {
    for (var i = 0; i < files.length; i++) {
      var filePath = cacheDir + '/' + files[i];
      if (fs.statSync(filePath).isFile()) {
      	console.log('removing file '+filePath);
        fs.unlinkSync(filePath);
      } else {
      	console.log('removing '+filePath);
        rmDir(filePath);
      }
    }
	}
}

module.exports.getBundle = function getBundle(cacheId) {
	var bundleJson, bundle;
	fs.readFile(getPathJson(cacheId).toString(), function (err, data) {
		if (err) {
			console.error('Error getting Bundle');
			return err;
		}	else {
			bundleJson = data;
			bundle = JSON.parse(bundleJson);
			return bundle;
		}
	});
}

module.exports.cache = function cache (epubfile, cacheId, cb) {

	if (typeof(arguments[2] === 'undefined')) {
		cb = cacheId;
		cacheId = null;
	}

	// if it exists already, we should retrieve from the cacheId instead
	if(cacheId && module.exports.has(cacheId)) {
		console.log('already cached...');
		return cb(null,cacheId, module.exports.getBundle(cacheId));
	}

	// cache it

	converter.parse(epubfile, function (err, epubData) {
	
		if(err) return cb(err);
		if(!epubData) return cb(new Error("No epub data found"));
		var htmlData = converter.convertMetadata(epubData);
		var files = converter.getFiles();
		var parser = converter.getParser();
		var hashid = epubData.easy.md5; //crypto.createHash('md5').update(fs.readFileSync(epubfile)).digest("hex");
		if(cacheId==null) {
			cacheId = hashid;
		}
		var basepath = basePath(cacheId);
		var pathjson = getPathJson(cacheId);
		
		if(module.exports.has(cacheId)) {
			//console.log('returning prematurely! + ', module.exports.has(cacheId));
			return cb(null,cacheId, module.exports.getBundle(cacheId));
		}
		
/*cacheid+'|'+epubData.easy.primaryID.value+'|'+epubData.easy.primaryID.scheme;//getUid();*/

	// This whole Block needs to be async, which is... i don't know how yet :P

		// 1. Creating the base Directory aka CacheID
		try {
			mkdirp(basepath, function (err) {
				if (err) throw err;
			});
		} catch (e) {
			console.log('Error creating directory: ', e);
		}
		var fq = new FileQueue(100);
		// 2. Create Subdirectories for every file or write the file to fs.
		for(file in files) {
			var path = basepath + files[file].name;
			try {
				// 2.1. If it's a directory create it
				if(files[file].options.dir) {
					mkdirp.sync(path); // <- This one is problematic
				} else {
					// 2.1.a. if it's a file check for filetype. Texts are extracted with extract TEXT other binaries are extracted via extractBinary
					if(file.match(/\.(html|xml|htm|css|js|txt|xhtml)$/)) {
						var data = runFilterChain(file, parser.extractText(file));
						fq.writeFile(path, data, function (err) {
							if (err) {
								return cb(new Error('Unable to write file to fs ', err));
							}
						});
					} else {
						var data = parser.extractBinary(file);
						fq.writeFile(path, data, 'binary', function (err) {
							if (err) {
								return cb(new Error('UNable to write file to fs ', err));
							}
						});
					}
				}
			} catch(e) {
				console.log(e);
			} 
		}
		
		delete epubData.raw.xml;

		var bundle = {
			epub: epubData,
			html: htmlData
		};
		fs.writeFile(pathjson, JSON.stringify(bundle), function (err) {
			if (err) {
				return cb(new Error ('Unable to write Bundle to fs'));
			}
		});
		return cb(null,cacheId, bundle);
	}); // end converter.parse
}

module.exports.getParser = function () {
	return converter.getParser();
}
