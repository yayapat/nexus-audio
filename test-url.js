const { URL } = require('url');
const url = new URL('nexus-local:///home/user/Music/a.mp3');
console.log(url.href);
const url2 = new URL('nexus-local://C:/Music/a.mp3');
console.log(url2.href);
