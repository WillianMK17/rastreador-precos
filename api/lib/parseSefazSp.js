import * as cheerio from 'cheerio';

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function toFloat(brNumber) {
  return parseFloat(brNumber.replace(/\./g, '').replace(',', '.'));
}

export function parseSefazSpHtml(html) {
  const $ = cheerio.load(html);

  const rows = $('#tabResult tr').toArray();
  if (rows.length === 0) {
    return { ok: false, reason: 'items-not-found' };
  }

  const storeName = normalizeWhitespace($('#u20').text());
  const cnpjText = normalizeWhitespace($('.txtCenter .text').eq(0).text());
  const cnpjMatch = cnpjText.match(/CNPJ:\s*([\d.\/-]+)/);
  const addressText = normalizeWhitespace($('.txtCenter .text').eq(1).text());
  const address = addressText
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .join(', ');

  const infosText = normalizeWhitespace($('#infos').text());
  const emittedMatch = infosText.match(/Emissão:\s*([\d/]+ [\d:]+)/);

  const chave = normalizeWhitespace($('.chave').text()).replace(/\s/g, '');

  const totalValueText = normalizeWhitespace($('#totalNota .linhaShade .totalNumb').first().text());

  const items = rows.map(row => {
    const $row = $(row);
    const description = normalizeWhitespace($row.find('span.txtTit').first().text());
    const codeText = normalizeWhitespace($row.find('.RCod').text());
    const codeMatch = codeText.match(/Código:\s*(\d+)/);
    const qtdText = normalizeWhitespace($row.find('.Rqtd').text());
    const qtdMatch = qtdText.match(/Qtde\.:\s*([\d.,]+)/);
    const unitText = normalizeWhitespace($row.find('.RUN').text());
    const unitMatch = unitText.match(/UN:\s*(\S+)/);
    const unitPriceText = normalizeWhitespace($row.find('.RvlUnit').text());
    const unitPriceMatch = unitPriceText.match(/Vl\.\s*Unit\.:\s*([\d.,]+)/);
    const totalPriceText = normalizeWhitespace($row.find('td.txtTit .valor').text());

    return {
      description,
      code: codeMatch ? codeMatch[1] : '',
      quantity: qtdMatch ? toFloat(qtdMatch[1]) : 0,
      unit: unitMatch ? unitMatch[1] : '',
      unitPrice: unitPriceMatch ? toFloat(unitPriceMatch[1]) : 0,
      totalPrice: totalPriceText ? toFloat(totalPriceText) : 0
    };
  });

  return {
    ok: true,
    store: {
      name: storeName,
      cnpj: cnpjMatch ? cnpjMatch[1] : '',
      address
    },
    receipt: {
      chaveAcesso: chave,
      emittedAt: emittedMatch ? emittedMatch[1] : '',
      totalValue: totalValueText ? toFloat(totalValueText) : 0
    },
    items
  };
}
