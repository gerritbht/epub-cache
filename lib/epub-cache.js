
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

		try {
			mkdirp(basepath, function (err) {
				if (err) throw err;
				var fq = new FileQueue(100);
				for(file in files) {
					var path = basepath + files[file].name;
					try {
						// 2.1. If it's a directory create it
						if(files[file].options.dir) {
							mkdirp.sync(path); // <- This one is problematic
						} else {
							// 2.1.a. if it's a file check for filetype. Texts are extracted with extractText
							if(file.match(/\.(html|xml|htm|css|js|txt|xhtml)$/)) { //Change imagepath HERE
								var data = runFilterChain(file, parser.extractText(file));

								// This replaces EVERY image address with the first one... not a solution
								/*
								var firstpass = data.match(/(?=img src=")(.*)(?=\.(png|jpe?g|bmp|tif))/);
								console.log("firstpass = ", firstpass);
								if (firstpass !== null) {
									console.log("image firstpass", firstpass[1]);
									console.log("image starts with", firstpass[1].substr(0, 9+epubData.paths.opsRoot.length));
									if (firstpass[1].substr(0, 9+epubData.paths.opsRoot.length) != ('img src="' + epubData.paths.opsRoot)) {
										var newpath = 'img src="' + epubData.paths.opsRoot + firstpass[1].substr(9, firstpass[1].length);
										console.log('newpath =', newpath);
										var result = data.replace(/(?=img src=")(.*)(?=\.(png|jpe?g|bmp|tif))/, newpath);
										fq.writeFile(path, result, function (err) {
											if (err) {
												return cb(new Error('Unable to write file to fs'));
											}
										});
									}
								}*/

									var ersatzPath = epubData.paths.navPath;
									if (ersatzPath === undefined) {
										ersatzPath = epubData.paths.opsRoot;
									}
									var newpath = 'src="' + ersatzPath;								
									var result = data.replace(/src="/g, newpath);
									var hrefpath = 'href="' + ersatzPath; //<- not as simple, what about http ?
									console.log("hrefpath = ", hrefpath);
									//var lastone = result.replace(/href="(?!http|#|\.)/g, hrefpath);
									var lastone = result.replace(/href="(?!http|#)/g, hrefpath);

									fq.writeFile(path, lastone, function (err) {
										if (err) {
											return cb(new Error('Unable to write file to fs'));
										}
									});
								
								

								// ATTENTION IMAGE TESTING AREA
								// Want to match the image patch between <img src="       " *blabla* />
								//[ '<img src="images/epubbooks-logo.png" alt="epubBooks Logo" title="epubBooks Logo"',
								/*
								var firstpass = data.match(/(?=img src=")(.*)(?=\.)/);
								var otherpath = data.match(/(?=link href=")(.*)(?=\.)/);
								//console.log('firstpass = ', firstpass[1]);
								//console.log('otherpath = ', otherpath[1]);
								if (firstpass !== null || otherpath !== null) {
									if (firstpass !== null && firstpass[1].substr(0, 9) === 'img src="') {
										if (firstpass[1].substr(0, 9+epubData.paths.opsRoot.length) != ('img src="' + epubData.paths.opsRoot)) {
											var newpath = 'img src="' + epubData.paths.opsRoot + firstpass[1].substr(9, firstpass[1].length);
											console.log('newpath =', newpath);
											var result = data.replace(/(?=img src=")(.*)(?=\.)/, newpath);
											fq.writeFile(path, result, function (err) {
												console.log('writing imageresult');
												if (err) {
													return cb(new Error('Unable to write file to fs'));
												}
											});
										}
									}
									if(otherpath !== null && otherpath[1].substr(0, 11) === 'link href="') {
										if (otherpath[1].substr(0, 11+epubData.paths.opsRoot.length) != ('link href="' + epubData.paths.opsRoot)) {
											var hrefpath = 'link href="' + epubData.paths.opsRoot + otherpath[1].substr(11, otherpath[1].length);
											console.log('hrefpath =', hrefpath);
											var result = data.replace(/(?=link href=")(.*)(?=\.)/, hrefpath);
											fq.writeFile(path, result, function (err) {
												console.log('Writing hrefresult');
												if (err) {
													return cb(new Error('Unable to write file to fs'));
												}
											});
										}
									}									
								}
								*/
								
								// 2.1.b. Otherwise use extractBinary
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
		} catch (e) {
			console.log('Error creating directory: ', e);
		}

		// 2. Create Subdirectories for every file or write the file to fs.
		delete epubData.raw.xml;
	}); // end converter.parse
}

module.exports.getParser = function () {
	return converter.getParser();
}
