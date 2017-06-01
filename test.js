var git = require('./git.js').git;

git(['version'])
.then(output => {
  console.log("Hello: " + output);
})
.catch(error => {
  console.log("Error: " + error)
});
