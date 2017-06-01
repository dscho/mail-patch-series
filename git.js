var spawn = require('./promising-spawn.js').spawn;

var git = function(args, stdin, options) {
	return spawn('git', args, stdin, options);
};

module.exports.git = git;
