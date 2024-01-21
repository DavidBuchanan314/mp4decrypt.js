#!/usr/bin/env node

const MP4Box = require("mp4box");
const fs = require("fs");
const { assert } = require("console");

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
			idx += 6
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

	const mp4 = MP4Box.createFile();

	mp4.onError = function(e) {
		console.log(e);
	};

	mp4.onReady = function(info) {
		console.log(info);
		mp4.setExtractionOptions(info.tracks[0].id, null, {}); // TODO: track selection?
		mp4.start();
	};

	mp4.onSamples = function(id, user, samples) {
		for (const sample of samples) {
			let senc = getSencForMoofNumber(mp4, sample.moof_number - 1); // is this an off by one lol (yeah, looks like it https://github.com/gpac/mp4box.js/blob/a8f4cd883b8221bedef1da8c6d5979c2ab9632a8/src/isofile-sample-processing.js#L402)
			let this_senc = senc[sample.number_in_traf];
			//console.log(sample);
			//console.log(senc);
			//console.log(sample.moof_number, senc.length, sample_idx, sample.number_in_traf, sample.number);
			//console.log(sample.size, this_senc.subsample_encryption_info[0].clear_bytes + this_senc.subsample_encryption_info[0].cipher_bytes);

			const ciphertext_parts = [];
			let idx = 0;
			for (const {clear_bytes, cipher_bytes} of this_senc.subsample_encryption_info) {
				ciphertext_parts.push(sample.data.subarray(idx+clear_bytes, idx+clear_bytes+cipher_bytes));
				idx += clear_bytes+cipher_bytes;
			}
			assert(idx === sample.data.length);
			const ciphertext = Buffer.concat(ciphertext_parts);
			console.log(ciphertext);

			//process.exit(); // TODO: keep going!
		}
	};
	
	// TODO: implement proper streamed loading!!!
	let buf = fs.readFileSync(input_path).buffer;
	buf.fileStart = 0;
	mp4.appendBuffer(buf);
	mp4.flush();
}

if (require.main === module) {
	mp4decrypt(process.argv[2], process.argv[3]);
}