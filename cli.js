#!/usr/bin/env node

/*
 * This script is intended to help submit patch series to projects which want
 * contributions to be sent to a mailing list. The process is not quite as
 * painless for the contributor as opening Pull Requests, but at least it is
 * much less painful than having to all the steps manually.
 *
 * Example usage:
 *
 *	/path/to/mail-patch-series.sh
 *
 * (All relevant information, such as the mailing list to which this patch
 * series needs to be sent, the current iteration of the patch series, etc is
 * inferred from the current branch in the current repository.)
 *
 * Currently, this script supports submitting patch series (or single patches)
 * to only two projects: Git and Cygwin, with the upstream remotes being called
 * 'upstream' and 'cygwin', respectively.
 *
 * To make use of this script, you first have to have a topic branch. It needs
 * to be rebased to the latest `master` (or `next` in the case of Git).
 *
 * Further, you need an alias called `send-mbox` that takes an mbox on stdin
 * and puts the individual mails into the Drafts folder of your maildir, ready
 * to send. Example for alias.send-mbox:
 *
 * [alias]
 *    send-mbox = !git mailsplit -o\"$HOME\"/Mail/Drafts/new
 *
 * When running this script on a newer iteration of the same topic branch, it
 * will detect that and use the appropriate [PATCH v<iteration>] prefix.
 *
 * This script will also use the branch description as cover letter. Unlike
 * plain format-patch, the first line will be used as subject and the rest as
 * mail body, without any ugly "*** Subject/Blurb here ***".
 *
 * Note that this script will demand a branch description (which can be added
 * or edited using `git branch --edit-description`) if the current topic branch
 * contains more that a single patch; For single-patch "series", the branch
 * description is optional.
 *
 * This script will also try to Cc: original authors when sending patches on
 * their behalf, and people mentioned in the Cc: footer of commit messages.
 *
 * To Cc: the entire patch series to, say, reviewers who commented on some
 * iteration of the patch series, the script supports being called with the
 * `--cc 'R E Viewer <reviewer@email.com>'` option; This information is then
 * stored in the config, and used when sending the next iteration.
 *
 * Furthermore, for a second or later iteration of a patch series, this script
 * will insert an interdiff, and reply to the cover letter of the previous
 * iteration. It stores the relevant information in local tags whose names
 * reflect the branch name and the iterarion. This tag is relevant in
 * particular for the interdiff, as that revision may need to be rebased for a
 * proper interdiff (in this case, a tag is generated whose name is of the form
 * <branch>-v<iteration>-rebased).
 *
 * Lastly, if the mail.publishtoremote is set in the config, the branch as well
 * as the generated tag(s) will be pushed to the remote of that name. If this
 * remote's URL points to GitHub, the URL to the tag will be sent together with
 * the patch series.
 *
 * If anything goes awry, an iteration can be regenerated/resent with the
 * `--redo` option.
 */

var die = function(err) {
	process.stderr.write(err + '\n');
	process.exit(1);
};

var callGitSync = function(args, options) {
	try {
		var child_process = require('child_process');
		if (typeof(options) == 'undefined')
			options = {};
		if (typeof(options['input']) == 'undefined')
			options['input'] = '';
		var result = child_process.spawnSync('git', args, options);
		var err = '' + result.stderr;
		!err || process.stderr.write(err + '\n');
		if ((typeof(options['gentle']) == 'undefined' ||
		     !options['gentle']) && result.status !== 0)
			die('git ' + args.join(' ') + ' failed with status ' +
				result.status);

		return ('' + result.stdout).replace(/\n$/, '');
	} catch (err) {
		die(err);
	}
};

var gitConfig = function(key) {
	return callGitSync(['config', key], { gentle: true });
};

gitConfig('alias.send-mbox') ||
die("Need an 'send-mbox' alias");

// figure out the iteration of this patch series
var branchname;
var shortname;

var getBranchName = function() {
	branchname = callGitSync(['rev-parse', '--symbolic-full-name', 'HEAD']);
	var match = branchname.match(/^refs\/heads\/(.*)/);
	match ||
	die('Not on a branch (' + branchname + ')?');
	shortname = match[1];
};

var redo = false;
var rfc = false;
var publishtoremote = gitConfig('mail.publishtoremote');
var patience = null;

var parseCommandLineOptions = function(argv) {
	var i, match;
	for (i = 2; i < argv.length; i++) {
		var arg = argv[i];
		if (arg == '--redo') redo = true;
		else if (arg == '--rfc') rfc = true;
		else if (match = arg.match(/^--publish-to-remote=.*/))
			publishtoremote = match[1];
		else if (arg == '--patience') patience = '--patience';
		else if (arg == '--cc') {
			var key = 'branch.' + shortname + '.cc';
			arg = i + 1 < argv.length ? argv[++i] : '';
			i + 1 == argv.length ||
			die('Too many arguments');
			if (!arg)
				console.log(callGitSync(['config', '--get-all', key]));
			else if (arg.match(/>.*>/) || arg.match(/>,/)) {
				arg.replaceAll(/> /, '>,').map(function(email) {
					email = email.trim();
					!email ||
					callGitSync(['config', '--add', key, email]);
				});
			} else if (arg.match(/@/))
				callGitSync(['config', '--add', key, arg]);
			else {
				var id = callGitSync(['log', '-1', '--format=%an <%ae>',
						     '--author=' + arg]);
				id ||
				die('Not an email address: ' + arg);
				callGitSync(['config', '--add', key, id]);
			}
			process.exit(0);
		} else if (match = arg.match(/^--basedon=(.*)/)) {
			var key = 'branch.' + shortname + '.basedon';
			callGitSync(['config', key, arg]);
			process.exit(0);
		} else if (arg == '--basedon') {
			var key = 'branch.' + shortname + '.basedon';
			if (i + 1 == argv.length)
				console.log(gitConfig(key));
			else if (i + 2 == argv.length)
				callGitSync(['config', key, argv[++i]]);
			else
				die('Too many arguments');
			process.exit(0);
		} else
			break;
	}

	if (i < argv.length)
		die('Usage: ' + argv[1] +
		    ' [--redo] [--publish-to-remote=<remote>] |\n' +
		    '--cc [<email-address>] | --basedon [<branch>]');

	if (!publishtoremote || !gitConfig('remote.' + publishtoremote + '.url'))
		die('No valid remote: ' + publishtoremote);
};

var commitExists = function(commit) {
	try {
		var child_process = require('child_process');
		var p = child_process.spawnSync('git', ['rev-parse', '--verify',
						commit], { input: '' });
		if (typeof(p.status) == 'undefined' || p.status != 0)
			return false;
		return true;
	} catch (err) {
		return false;
	}
}

// For now, only the Git and Cygwin projects are supported
var to, cc = [], upstreamBranch;
var midUrlPrefix = ' Message-ID: ';

var determineProject = function() {
	if (commitExists('e83c5163316f89bfbde')) {
		// Git
		to = '--to=git@vger.kernel.org';
		cc.push('Junio C Hamano <gitster@pobox.com>');
		upstreambranch = 'upstream/pu';
		if (callGitSync(['rev-list', branchname + '..' + upstreambranch]))
			upstreambranch = 'upstream/next';
		if (callGitSync(['rev-list', branchname + '..' + upstreambranch]))
			upstreambranch = 'upstream/master';
		midUrlPrefix = 'https://public-inbox.org/git/';
	} else if (commitExists('a3acbf46947e52ff596')) {
		// Cygwin
		to = '--to=cygwin-patches@cygwin.com';
		upstreambranch = 'cygwin/master';
		midUrlPrefix = 'https://www.mail-archive.com/search?l=cygwin-patches@cygwin.com&q=';
	} else if (commitExists('cc8ed39b240180b5881')) {
		// BusyBox
		to = '--to=busybox@busybox.net';
		upstreambranch = 'busybox/master';
		midUrlPrefix = 'https://www.mail-archive.com/search?l=busybox@busybox.net&q=';
	} else
		die('Unrecognized project');
};

var basedon;

var determineBaseBranch = function() {
	basedon = gitConfig('branch.' + shortname + '.basedon');
	if (basedon && commitExists(basedon)) {
		publishtoremote ||
		die('Need a remote to publish to');

		var remoteRef = 'refs/remotes/' + publishtoremote + '/' + basedon;
		if (!commitExists(remoteRef))
			die(basedon + ' not pushed to ' + publishtoremote);

		var commit = callGitSync(['rev-parse', '-q', '--verify', remoteRef]);
		callGitSync(['rev-parse', basedon]) == commit ||
		die(basedon + ' on ' + publishtoremote +
		    ' disagrees with local branch');

		upstreambranch = basedon;
	}

	!callGitSync(['rev-list', branchname + '..' + upstreambranch]) ||
	die('Branch ' + shortname + ' is not rebased to ' + upstreambranch);
};

var getCc = function() {
	// Cc: from config
	callGitSync(['config', '--get-all',
		    'branch.' + shortname + '.cc']).split('\n').map(function(email) {
		!email ||
		cc.push(email);
	});
};

var patch_no, subject_prefix = null, in_reply_to = [], interdiff;

var determineIteration = function() {
	var latesttag = callGitSync(['for-each-ref', '--format=%(refname)',
			    '--sort=-taggerdate',
			    'refs/tags/' + shortname + '-v*[0-9]']).split('\n');
	if (redo)
		latesttag = latesttag.length > 1 ? latesttag[1] : '';
	else
		latesttag = latesttag.length > 0 ? latesttag[0] : '';
	if (!latesttag) {
		patch_no = 1;
		subject_prefix = rfc ? '--subject-prefix=PATCH/RFC' : null;
		interdiff = '';
	} else {
		callGitSync(['rev-list', branchname + '...' + latesttag]) ||
		die('Branch ' + shortname + ' was already submitted: ' + latesttag);

		patch_no = parseInt(latesttag.match(/-v([1-9][0-9]*)$/)[1]) + 1;
		subject_prefix = '--subject-prefix=PATCH' + (rfc ? '/RFC' : '') +
			' v' + patch_no;
		var tagMessage = callGitSync(['cat-file', 'tag', latesttag]);
		match = tagMessage.match(/^[\s\S]*?\n\n([\s\S]*)/);
		(match ? match[1] : tagMessage).split('\n').map(function(line) {
			match = line.match(/https:\/\/public-inbox\.org\/.*\/([^\/]+)/);
			if (!match)
				match = line.match(/https:\/\/www\.mail-archive\.com\/.*\/([^\/]+)/);
			if (!match)
				match = line.match(/http:\/\/mid.gmane.org\/(.*)/);
			if (!match)
				match = line.match(/^[^ :]*: Message-ID: ([^\/]+)/);
			if (match)
				in_reply_to.unshift(match[1]);
		});

		if (!callGitSync(['rev-list', latesttag + '..' + upstreambranch]))
			interdiff =  callGitSync(['diff',
						 latesttag + '..' + branchname]);
		else {
			var rebasedtag = latesttag + '-rebased';
			if (commitExists(rebasedtag)) {
				if (callGitSync(['rev-list',
						rebasedtag + '..' + upstreambranch])) {
					console.log('Re-rebasing ' + rebasedtag);
					callGitSync(['checkout', rebasedtag + '^0']);
					callGitSync(['rebase', upstreambranch]);
					var tagName =
						rebasedtag.match(/^refs\/tags\/(.*)/)[1];
					callGitSync(['-c', 'core.editor=true', 'tag',
						    '-f', '-a', tagName]);
					if (publishtoremote)
						callGitSync(['push', publishtoremote,
							    '+' + rebasedtag]);
					callGitSync(['checkout', shortname]);
				}
			} else {
				// Need rebasing
				console.log('Rebasing ' + latesttag);
				callGitSync(['checkout', latesttag + '^0']);
				callGitSync(['rebase', upstreambranch]);
				var msg = callGitSync(['cat-file', 'tag', latesttag]);
				msg = msg.match(/\n\n(.*)/)[1];
				var tagName = rebasedtag.match(/^refs\/tags\/(.*)/)[1];
				callGitSync(['tag', '-F', '-', '-a', tagName],
					{ input: msg });
				if (publishtoremote)
					callGitSync(['push', publishtoremote,
						    rebasedtag]);
				callGitSync(['checkout', shortname]);
			}
			interdiff = callGitSync(['diff',
						rebasedtag + '..' + branchname]);
		}
	}

	console.log('Submitting ' + shortname + ' v' + patch_no);
};

var cover_letter = null;

var generateMBox = function() {
	// Auto-detect whether we need a cover letter
	if (gitConfig('branch.' + shortname + '.description'))
		cover_letter = '--cover-letter';
	else if (1 < parseInt(callGitSync(['rev-list', '--count',
				     upstreambranch + '..' + branchname])))
		die('Branch ' + shortname + ' needs a description');

	var commitRange = upstreambranch + '..' + branchname;
	var args = [ 'format-patch', '--thread', '--stdout', '--add-header=Fcc: Sent',
	    '--add-header=Content-Type: text/plain; charset=UTF-8',
	    '--base', upstreambranch, to ];
	cc.map(email => { args.push('--cc=' + email); });
	in_reply_to.map(email => { args.push('--in-reply-to=' + email); });
	[ subject_prefix, cover_letter, patience]
	    .map(o => { o === null || args.push(o); });

	args.push(commitRange);
	console.log('Generating mbox');

	return callGitSync(args);
};

var insertCcAndFromLines = function() {
	var ident = callGitSync(['var', 'GIT_AUTHOR_IDENT']);
	var thisauthor = ident.match(/.*>/)[0];
	thisauthor || die('Could not determine author ident from ' + ident);
	var separatorRegex = /^From [0-9a-f]{40} Mon Sep 17 00:00:00 2001$/;

	console.log('Adding Cc: and explict From: lines for other authors, if needed');

	for (var i = 0; i < lines.length; i++) {
		if (!lines[i].match(separatorRegex))
			continue;
		var from = -1, cc = -1, author = null, cced = null;
		for (i = i + 1; i < lines.length && lines[i] != ''; i++) {
			var match = lines[i].match(/^(From|Cc): (.*)/);
			if (match && match[1] == 'From') {
				from < 0 || die('Duplicate From: header');
				from = i;
				author = match[2];
			} else if (match && match[2] == 'Cc') {
				cc < 0 || die('Duplicate Cc: header');
				cc = i;
				cced = match[2];
			}
		}
		from >= 0 || die('Missing From: line');
		if (author !== thisauthor) {
			lines[from] = 'From: ' + thisauthor;
			if (cc < 0) {
				lines.splice(from + 1, 0, 'Cc: ' + author);
				i++;
			} else
				lines[cc] = 'Cc: ' + author + ', ' + cced;
			lines.splice(i + 1, 0, 'From: ' + author, '');
		}
	}
};

var adjustCoverLetter = function() {
	if (cover_letter) {
		console.log('Fixing Subject: line of the cover letter');
		var subjectRegex = /^(Subject:.*) \*\*\* SUBJECT HERE \*\*\*$/;
		for (var i = 0; i < lines.length; i++) {
			var match = lines[i].match(subjectRegex);
			if (!match)
				continue;
			var subject = i;
			lines[subject] = match[1];

			while (i < lines.length && lines[i] !== '')
				i++;
			var body = i++;
			i + 3 < lines.length || die('Could not find cover letter');
			lines[i++] === '*** BLURB HERE ***' || die('No BLURB line?');
			lines[i++] === '' || die('Line after BLURB not empty');
			while (i < lines.length && lines[i] !== '') {
				lines[subject] += ' ' + lines[i];
				i++;
			}
			lines.splice(body, i - body);
		}
	}
};

var generateTagMessage = function() {
	console.log("Generating tag message");
	var tagmessage;

	if (!cover_letter)
		tagmessage = callGitSync(['cat-file', 'commit', branchname])
			.replace(/\n\n.*/, '');
	else {
		tagmessage = '';
		for (var i = 0; i < lines.length; i++) {
			var match = lines[i].match(/^Subject: (.*)/);
			if (!match)
				continue;
			tagmessage = match[1];
			while (i < lines.length && lines[i] != '')
				i++;
			while (i < lines.length && lines[i] != '-- ')
				tagmessage += '\n' + lines[i++];
			break;
		}
	}

	return tagmessage;
};

var findFooter = function() {
	console.log("Finding location for the footers");
	var dashdash = 0;
	if (cover_letter)
		while (dashdash < lines.length && lines[dashdash] !== '-- ')
			dashdash++;
	else
		while (++dashdash < lines.length && lines[dashdash - 1] !== '---')
			dashdash++;
	return dashdash;
};

var insertLinks = function() {
	if (!publishtoremote)
		return;

	console.log('Inserting links');
	var url = gitConfig('remote.' + publishtoremote + '.url');
	var match = url.match(/^https?(:\/\/github\.com\/.*)/);
	if (match)
		url = 'https' + match[1];
	else if (match = url.match(/^(git@)?github\.com(:.*)/))
		url = 'https://github.com/' + match[1];
	else
		url = '';
	if (url) {
		if (basedon) {
			lines.splice(dashdash, 0,
				     'Based-On: ' + basedon + ' at ' + url,
				     'Fetch-Base-Via: git fetch '
				     + url + ' ' + basedon);
			dashdash += 2;
		}
		lines.splice(dashdash, 0,
			     'Published-As: ' + url + '/releases/tag/'
			     + tagname,
			     'Fetch-It-Via: git fetch ' + url + ' ' + tagname);
		dashdash += 2;
	}
};

var generateTagObject = function() {
	console.log('Generating tag object');
	var messageID = null;
	for (var i = 0; i < lines.length; i++) {
		var match = lines[i].match(/^Message-ID: <(.*)>/i);
		if (match) {
			messageID = match[1];
			break;
		}
	}

	tagmessage += '\n\nSubmitted-As: ' + midUrlPrefix + messageID;
	in_reply_to.map(id => {
		tagmessage += '\nIn-Reply-To: ' + midUrlPrefix + id;
	});
	args = ['tag', '-F', '-', '-a'];
	!redo || args.push('-f');
	args.push(tagname);
	callGitSync(args, { 'input': tagmessage });

	if (interdiff) {
		console.log('Inserting interdiff');
		// construct the arguments for split():
		// first, split the interdiff and prefix with a space
		var args = interdiff.split('\n').map(line => { return ' ' + line; });
		// now, shift in the (start, count) parameters, an empty line and the
		// "Interdiff vs v$(($patch_no-1)):" label
		args.splice(0, 0, dashdash, 0,
			'', 'Interdiff vs v' + (patch_no-1) + ':');
		// and finally call splice() using the apply() method on the prototype
		[].splice.apply(lines, args);
	}
};

var sendMBox = function() {
	console.log('Calling the `send-mbox` alias');
	callGitSync(['send-mbox'], { 'input': lines.join('\n') });
};

var publishBranch = function() {
	if (!publishtoremote)
		return;

	console.log('Publishing branch and tag');
	if (redo)
		tagname = '+' + tagname;
	callGitSync(['push', publishtoremote, '+' + branchname, tagname]);
};

getBranchName();
parseCommandLineOptions(process.argv);
determineProject();
determineBaseBranch();
getCc();
determineIteration();
var lines = generateMBox().split('\n');
insertCcAndFromLines();
adjustCoverLetter();
var tagmessage = generateTagMessage();
var dashdash = findFooter();
var tagname = shortname + '-v' + patch_no;
insertLinks();
generateTagObject();
sendMBox();
publishBranch();
