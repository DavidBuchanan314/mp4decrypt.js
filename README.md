# mp4decrypt.js [WIP]

`mp4decrypt` CLI utility implemented using MP4Box.js

The goal is feature parity with [Bento4 mp4decrypt](https://www.bento4.com/documentation/mp4decrypt/)

Current status: It works for `cenc` mode! However, it's extremely hacky, it just decrypts in-place and doesn't rewrite any of the metadata. The resultant file is playable in mpv at least.