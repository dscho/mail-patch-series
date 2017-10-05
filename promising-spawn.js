/*
 * The ISC License (ISC)
 *
 * Copyright (c)  <> ()
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * The code is originally from https://github.com/raineorshine/spawn-please.
 */
var originalSpawn = require('child_process').spawn

if (typeof Promise === 'undefined')
  throw new Error('Need Promises');

var spawn = function(command, args, stdin, options) {

  // make stdin optional (options is an object, stdin is a string)
  if (options === undefined && typeof stdin !== 'object') {
    options = stdin;
    stdin = undefined;
  }

  // defaults
  options = options || {};
  if (options.rejectOnError === undefined)
    options.rejectOnError = true;

  var stdout = '';
  var stderr = '';
  var child = originalSpawn(command, args, options);

  return new Promise(function (resolve, reject) {

    if (stdin !== undefined)
      child.stdin.write(stdin);
    child.stdin.end();

    child.stdout.on('data', function (data) {
      stdout += data;
    });

    child.stderr.on('data', function (data) {
      stderr += data;
    });

    if (options.rejectOnError)
      child.addListener('error', reject);

    child.on('close', function (code) {
      if (code !== 0 && options.rejectOnError)
        reject(stderr);
      else
        resolve(stdout);
    });
  });
};

module.exports.spawn = spawn;