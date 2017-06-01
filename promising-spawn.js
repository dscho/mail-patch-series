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
 * The code is originally from * https://github.com/raineorshine/spawn-please.
 */
var spawn = require('child_process').spawn

function spawnPlease(command, args, stdin, options) {

  // if there are only three arguments and the third argument is an object, treat it as the options object and set stdin to null
  if(!options && typeof stdin === 'object') {
    options = stdin
    stdin = undefined
  }

  // defaults
  options = options || {}
  if(options.rejectOnError === undefined) {
    options.rejectOnError = true
  }

  var stdout = ''
  var stderr = ''
  var child = spawn(command, args, options)

  if(!spawnPlease.Promise) {
    throw new Error('No built-in Promise. You will need to use a Promise library and spawnPlease.Promise = Promise.')
  }

  return new spawnPlease.Promise(function (resolve, reject) {

    if(stdin !== undefined) {
      child.stdin.write(stdin)
    }
    child.stdin.end()

    child.stdout.on('data', function (data) {
      stdout += data
    })

    child.stderr.on('data', function (data) {
      stderr += data
    })

    if(options.rejectOnError) {
      child.addListener('error', reject)
    }

    child.on('close', function (code) {
      if(code !== 0 && options.rejectOnError) {
        reject(stderr)
      }
      else {
        resolve(stdout)
      }
    })

  })
}

spawnPlease.Promise = typeof Promise !== 'undefined' ? Promise : null

module.exports = spawnPlease
