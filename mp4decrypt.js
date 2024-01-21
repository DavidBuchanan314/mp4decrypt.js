#!/usr/bin/env node

const MP4Box = require("mp4box");
const fs = require("fs");
const { assert } = require("console");
const crypto = require("node:crypto");
const { maxHeaderSize } = require("http");

// see mp4box.js/src/parsing/senc.js
function parseSencBody(data, iv_length) {
	const buf = Buffer.from(data);
	const sample_count = buf.readInt32BE();
	let idx = 4;
	const sample_infos = [];
	for (let i=0; i<sample_count; i++) {
		let sample_info = {
			iv: buf.subarray(idx, idx+iv_length),
			subsample_encryption_info: []
		};
		idx += iv_length;

		const subsample_count = buf.readInt16BE(idx);
		idx += 2;

		for (let j=0; j<subsample_count; j++) {
			sample_info.subsample_encryption_info.push({
				clear_bytes: buf.readInt16BE(idx),
				cipher_bytes: buf.readInt32BE(idx + 2)
			});
			idx += 6;
		}

		sample_infos.push(sample_info);
	}
	return sample_infos;
}


function getSencForMoofNumber(mp4, num) {
	if (mp4.senc_cache_num === num) {
		return mp4.senc_cache;
	}
	let moof = mp4.moofs[num];
	let senc = moof.trafs[0].senc; // XXX: is trafs[0] always correct?
	mp4.senc_cache_num = num;
	mp4.senc_cache = parseSencBody(senc.data, 16); // XXX: moov/trak/mdia/minf/stbl/stsd/encv/sinf/schi/tenc.default_iv_size (wow that's a lot)
	return mp4.senc_cache;
}

function mp4decrypt(input_path, output_path) {
	if (!input_path || !output_path) {
		console.log("USAGE: ./mp4decrypt.js input.mp4 output.mp4")
		return;
	}

	fs.copyFileSync(input_path, output_path); // start off with a copy of the input file
	const outfile = fs.openSync(output_path, "r+");

	//const writestream = new MP4Box.DataStream();
	//writestream.endianness = MP4Box.DataStream.BIG_ENDIAN;

	const mp4 = MP4Box.createFile();
	//mp4.my_samples = [];
	//mp4.prev_moof = 1;

	mp4.onError = function(e) {
		console.log(e);
	};

	mp4.onReady = function(info) {
		console.log(info);
		//mp4.boxes[0].write(writestream);
		//mp4.boxes[1].write(writestream);
		mp4.setExtractionOptions(info.tracks[0].id, null, {}); // TODO: track selection?
		mp4.start();
	};

	mp4.onSamples = function(id, user, samples) {
		for (const sample of samples) {
			let senc = getSencForMoofNumber(mp4, sample.moof_number - 1); // is this an off by one lol (yeah, looks like it https://github.com/gpac/mp4box.js/blob/a8f4cd883b8221bedef1da8c6d5979c2ab9632a8/src/isofile-sample-processing.js#L402)
			let this_senc = senc[sample.number_in_traf];

			// TODO: also implement CBCS

			// first, extract the ciphertext fragments into a contiguous buffer
			const ciphertext_parts = [];
			let idx = 0;
			for (const {clear_bytes, cipher_bytes} of this_senc.subsample_encryption_info) {
				ciphertext_parts.push(sample.data.subarray(idx+clear_bytes, idx+clear_bytes+cipher_bytes));
				idx += clear_bytes+cipher_bytes;
			}
			assert(idx === sample.data.length);
			const ciphertext = Buffer.concat(ciphertext_parts);

			// then decrypt it
			const key = Buffer.from("100b6c20940f779a4589152b57d2dacb", "hex");
			const cipher = crypto.createCipheriv("AES-128-CTR", key, this_senc.iv);
			const plaintext = Buffer.concat([cipher.update(ciphertext), cipher.final()]);

			// finally, reconstitute the decrypted sample
			const decrypted_sample_parts = [];
			let sample_idx = 0;
			let pt_idx = 0;
			for (const {clear_bytes, cipher_bytes} of this_senc.subsample_encryption_info) {
				console.log(clear_bytes, cipher_bytes);
				decrypted_sample_parts.push(sample.data.subarray(sample_idx, sample_idx+clear_bytes));
				sample_idx += clear_bytes + cipher_bytes;
				decrypted_sample_parts.push(plaintext.subarray(pt_idx, pt_idx+cipher_bytes));
				pt_idx += cipher_bytes;
			}
			const decrypted_sample = Buffer.concat(decrypted_sample_parts);

			fs.writeSync(outfile, decrypted_sample, 0, decrypted_sample.length, sample.offset);

			/*if (mp4.prev_moof != sample.moof_number) { // this is a bit hacky but it works, maybe
				mp4.prev_moof = sample.moof_number;
				console.log("new moof");
				const mdat = new MP4Box.BoxParser.mdatBox();
				mdat.data = Buffer.concat(mp4.my_samples);
				mp4.my_samples = [];
				mp4.moofs[sample.moof_number - 2].write(writestream);
				mdat.write(writestream);
			}
			mp4.my_samples.push(decrypted_sample);*/

			//console.log(sample);

			//process.exit(); // TODO: keep going!
		}
	};
	
	// TODO: implement proper streamed loading!!!
	let buf = fs.readFileSync(input_path).buffer;
	buf.fileStart = 0;
	mp4.appendBuffer(buf);
	mp4.flush();
	fs.closeSync(outfile);
	//console.log("abc");
	//mp4.write(writestream);
	//fs.writeFileSync(output_path, Buffer.from(writestream.buffer));
}

if (require.main === module) {
	mp4decrypt(process.argv[2], process.argv[3]);
}