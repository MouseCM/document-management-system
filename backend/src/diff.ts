import * as Diff from 'diff';
import pdfParse from 'pdf-parse';
import AdmZip from 'adm-zip';
import xml2js from 'xml2js';

export const comparePdf = async (buffer1: Buffer, buffer2: Buffer) => {
  const data1 = await pdfParse(buffer1);
  const data2 = await pdfParse(buffer2);

  const diff = Diff.diffWords(data1.text, data2.text);
  return diff;
};

export const compareWord = async (buffer1: Buffer, buffer2: Buffer) => {
  const extractXml = async (buffer: Buffer) => {
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();
    const docEntry = zipEntries.find(e => e.entryName === 'word/document.xml');
    if (!docEntry) throw new Error('Invalid Word Document');
    
    const xmlData = docEntry.getData().toString('utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);
    return JSON.stringify(result, null, 2);
  };

  const text1 = await extractXml(buffer1);
  const text2 = await extractXml(buffer2);

  const diff = Diff.diffLines(text1, text2);
  return diff;
};

export const compareText = (text1: string, text2: string) => {
  return Diff.diffWordsWithSpace(text1, text2);
};
