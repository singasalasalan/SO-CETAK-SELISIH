
function getHeaders() {
  const key = process.env.ALFA_API_KEY;

  return {
    ...(key ? { "Api-Key": key, "x-api-key": key } : {}),
    "App-Name": "CEXP-CLOUD",
    "Platform": "ANDROID",
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 Chrome/114.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/json,*/*"
  };
}

function cleanText(html = "") {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method tidak diizinkan" });
  }

  if (!process.env.ALFA_API_KEY) {
    return res.status(500).json({
      error: "ALFA_API_KEY belum dipasang di Vercel"
    });
  }

  try {
    const storeId = String(req.query.storeId || "").trim().toUpperCase();
    const dateSo = String(req.query.dateSo || "").trim();
    const plu = String(req.query.plu || "").trim();
    const stockFisik =
      parseFloat(String(req.query.stockFisik || "0")) || 0;

    if (!storeId || !dateSo || !plu) {
      return res.status(400).json({
        error: "storeId, dateSo, dan plu wajib diisi"
      });
    }

    const url =
      `https://app.alfastore.co.id/prd/api/rpt/laporan/laporan_posisi_mutasi_per_plu?storeId=${encodeURIComponent(storeId)}&periode1=${encodeURIComponent(dateSo)}&periode2=${encodeURIComponent(dateSo)}&plu=${encodeURIComponent(plu)}`;

    const response = await fetch(url, { headers: getHeaders() });

    if (!response.ok) {
      return res.status(502).json({
        error: "Gagal mengambil data mutasi dari server sumber",
        upstreamStatus: response.status,
        plu
      });
    }

    const html = await response.text();

    const tbody = html.match(
      /<table class="datatable"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i
    );

    if (!tbody) {
      return res.status(200).json({
        plu,
        stockOh: stockFisik,
        plusMinus: 0,
        found: false
      });
    }

    const rows = [...tbody[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

    for (const row of rows) {
      const tds = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(m => cleanText(m[1]));

      if (tds.length >= 10 && tds[1] === plu) {
        const number = value =>
          parseFloat(value.replace(/,/g, "")) || 0;

        const saldoAwal = number(tds[3]);
        const receipt = number(tds[4]);
        const returnQty = number(tds[5]);
        const sales = number(tds[6]);
        const koreksi = number(tds[7]);
        const saldo = number(tds[8]);
        const selisi = number(tds[9]);

        const stockOh = koreksi !== 0 ? saldo - koreksi : saldo;

        return res.status(200).json({
          plu,
          tgl: tds[0],
          namaProduct: tds[2],
          saldoAwal,
          receipt,
          return: returnQty,
          sales,
          koreksi,
          saldo,
          selisi,
          stockOh,
          plusMinus: stockFisik - stockOh,
          found: true
        });
      }
    }

    return res.status(200).json({
      plu,
      stockOh: stockFisik,
      plusMinus: 0,
      found: false
    });
  } catch (error) {
    console.error("Error mutasi PLU:", error);

    return res.status(500).json({
      error: "Terjadi kesalahan pada server",
      detail: error.message
    });
  }
}

