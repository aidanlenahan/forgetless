import { describe, it, expect } from 'vitest';
import {
	parseCsv,
	csvRecords,
	unwrapExcel,
	sniffDelimiter,
	csvRow
} from '../../src/lib/shared/csv';

describe('parseCsv', () => {
	it('parses plain rows with CRLF, LF and CR line endings', () => {
		expect(parseCsv('a,b\r\n1,2\n3,4\r5,6')).toEqual([
			['a', 'b'],
			['1', '2'],
			['3', '4'],
			['5', '6']
		]);
	});

	it('handles quotes, escaped quotes, delimiters and newlines inside quotes', () => {
		const text = 'name,note\r\n"Lucali, ""the"" pizza","line 1\r\nline 2"\r\n"",x\r\n';
		expect(parseCsv(text)).toEqual([
			['name', 'note'],
			['Lucali, "the" pizza', 'line 1\r\nline 2'],
			['', 'x']
		]);
	});

	it('strips a BOM, keeps empty trailing fields and drops blank lines', () => {
		expect(parseCsv('﻿a,b,c\n\n1,,\n')).toEqual([
			['a', 'b', 'c'],
			['1', '', '']
		]);
	});

	it('handles a last row without a newline and other delimiters', () => {
		expect(parseCsv('a;b\n"x;y";z', ';')).toEqual([
			['a', 'b'],
			['x;y', 'z']
		]);
		expect(sniffDelimiter('Name;Year;"a,b"\n1;2;3')).toBe(';');
		expect(sniffDelimiter('a\tb\tc')).toBe('\t');
		expect(sniffDelimiter('title')).toBe(',');
	});

	it('handles a trailing delimiter at end of input and an unterminated quote', () => {
		expect(parseCsv('a,b\n1,')).toEqual([
			['a', 'b'],
			['1', '']
		]);
		expect(parseCsv('a\n"open, never closed\nstill')).toEqual([
			['a'],
			['open, never closed\nstill']
		]);
	});

	it('round-trips with the CSV writer', () => {
		const values = ['Lucali, "the" pizza', 'two\nlines', ' padded ', 'plain'];
		expect(parseCsv(csvRow(values))).toEqual([values]);
	});
});

describe('csvRecords / unwrapExcel', () => {
	it('keys rows by trimmed header and fills missing cells', () => {
		const t = csvRecords(' Title ,Year\nArrival,2016\nShort\n');
		expect(t.headers).toEqual(['Title', 'Year']);
		expect(t.rows).toEqual([
			{ Title: 'Arrival', Year: '2016' },
			{ Title: 'Short', Year: '' }
		]);
	});

	it('unwraps ="..." (Goodreads ISBNs) and leaves other values alone', () => {
		const [row] = csvRecords('ISBN,ISBN13,Other\n"=""0441478123""","=""""",=x\n').rows;
		expect(unwrapExcel(row.ISBN)).toBe('0441478123');
		expect(unwrapExcel(row.ISBN13)).toBe('');
		expect(unwrapExcel(row.Other)).toBe('=x');
		expect(unwrapExcel(undefined)).toBe('');
	});
});
