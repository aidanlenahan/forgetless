// Builds the self-hosted fonts in static/fonts/ from the @fontsource-variable packages.
// Run after upgrading the font packages: `npm run fonts`. The output is committed, so builds stay offline.
//
// To keep the first load light, the fonts are subset to Latin-1 plus typographic punctuation, and
// Newsreader is pinned (harfbuzz instancing) to the two styles the UI uses: roman 560 and italic 500.
// Instrument Sans stays variable (400-700) because the UI uses several weights of it.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import subsetFont from 'subset-font';

const RANGES = [
	[0x20, 0x7e],
	[0xa0, 0xff],
	[0x131, 0x131],
	[0x152, 0x153],
	[0x2c6, 0x2c6],
	[0x2da, 0x2da],
	[0x2dc, 0x2dc],
	[0x2013, 0x2014],
	[0x2018, 0x201a],
	[0x201c, 0x201e],
	[0x2022, 0x2022],
	[0x2026, 0x2026],
	[0x2032, 0x2033],
	[0x2039, 0x203a],
	[0x20ac, 0x20ac],
	[0x2122, 0x2122],
	[0x2190, 0x2193],
	[0x2212, 0x2212]
];
let text = '';
for (const [a, b] of RANGES) for (let c = a; c <= b; c++) text += String.fromCodePoint(c);

const NR = 'node_modules/@fontsource-variable/newsreader';
const IS = 'node_modules/@fontsource-variable/instrument-sans';
const FONTS = [
	[`${NR}/files/newsreader-latin-wght-normal.woff2`, 'newsreader-560.woff2', { wght: 560 }],
	[`${NR}/files/newsreader-latin-wght-italic.woff2`, 'newsreader-italic-500.woff2', { wght: 500 }],
	[`${IS}/files/instrument-sans-latin-wght-normal.woff2`, 'instrument-sans-wght.woff2', null]
];

mkdirSync('static/fonts', { recursive: true });
for (const [src, out, axes] of FONTS) {
	const buf = await subsetFont(readFileSync(src), text, {
		targetFormat: 'woff2',
		...(axes ? { variationAxes: axes } : {})
	});
	writeFileSync(`static/fonts/${out}`, buf);
	console.log(`static/fonts/${out}  ${(buf.length / 1024).toFixed(1)} KB`);
}
copyFileSync(`${NR}/LICENSE`, 'static/fonts/LICENSE-newsreader.txt');
copyFileSync(`${IS}/LICENSE`, 'static/fonts/LICENSE-instrument-sans.txt');
