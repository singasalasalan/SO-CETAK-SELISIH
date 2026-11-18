
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

async function fetchMutasi(storeId, dateSo, plu, stockFisik = 0) {
  const url =
    `https://app.alfastore.co.id/prd/api/rpt/laporan/laporan_posisi_mutasi_per_plu?storeId=${encodeURIComponent(storeId)}&periode1=${encodeURIComponent(dateSo)}&periode2=${encodeURIComponent(dateSo)}&plu=${encodeURIComponent(plu)}`;

  const response = await fetch(url, { headers: getHeaders() });

  if (!response.ok) {
    return { plu, stockOh: stockFisik, plusMinus: 0, found: false };
  }

  const html = await response.text();
  const tbody = html.match(/<table class="datatable"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);

  if (!tbody) {
    return { plu, stockOh: stockFisik, plusMinus: 0, found: false };
  }

  const rows = [...tbody[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

  for (const row of rows) {
    const tds = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(m => cleanText(m[1]));

    if (tds.length >= 10 && tds[1] === plu) {
      const number = value => parseFloat(value.replace(/,/g, "")) || 0;
      const saldo = number(tds[8]);
      const koreksi = number(tds[7]);
      const stockOh = koreksi !== 0 ? saldo - koreksi : saldo;

      return {
        plu,
        tgl: tds[0],
        namaProduct: tds[2],
        saldoAwal: number(tds[3]),
        receipt: number(tds[4]),
        return: number(tds[5]),
        sales: number(tds[6]),
        koreksi,
        saldo,
        selisi: number(tds[9]),
        stockOh,
        plusMinus: stockFisik - stockOh,
        found: true
      };
    }
  }

  return { plu, stockOh: stockFisik, plusMinus: 0, found: false };
}

async function runConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      () => worker()
    )
  );

  return results;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method tidak diizinkan" });
  }

  if (!process.env.ALFA_API_KEY) {
    return res.status(500).json({ error: "ALFA_API_KEY belum dipasang di Vercel" });
  }

  try {
    const storeId = String(req.query.storeId || "").trim().toUpperCase();
    const dateSo = String(req.query.dateSo || "").trim();

    if (!storeId || !dateSo) {
      return res.status(400).json({
        error: "storeId dan dateSo wajib diisi"
      });
    }

    const url =
      `https://app.alfastore.co.id/prd/api/rpt/laporan_so/prosentase_so?storeId=${encodeURIComponent(storeId)}&dateSo=${encodeURIComponent(dateSo)}`;

    const response = await fetch(url, { headers: getHeaders() });

    if (!response.ok) {
      return res.status(502).json({
        error: "Gagal mengambil data dari server sumber",
        upstreamStatus: response.status
      });
    }

    const html = await response.text();

    const match = pattern => html.match(pattern);

    const mReport = match(/Report<\/td>\s*<td[^>]*>:<\/td>\s*<td[^>]*>(.*?)<\/td>/i);
    const mToko = match(/Toko<\/td>\s*<td[^>]*>:<\/td>\s*<td[^>]*>(.*?)<\/td>/i);
    const mTokoSub = match(/<\/tr>\s*<tr>\s*<td>(?:&nbsp;|\s*)<\/td>\s*<td[^>]*>(?:&nbsp;|\s*)<\/td>\s*<td[^>]*>(.*?)<\/td>/i);
    const mTanggalSo = match(/Tanggal SO<\/td>\s*<td[^>]*>:<\/td>\s*<td[^>]*>(.*?)<\/td>/i);
    const mTanggalCetak = match(/Tanggal Cetak<\/td>\s*<td[^>]*>:<\/td>\s*<td[^>]*>(.*?)<\/td>/i);
    const mJenisSo = match(/Jenis SO<\/td>\s*<td[^>]*>:<\/td>\s*<td[^>]*>(.*?)<\/td>/i);
    const mTotalSo = match(/Total Item SO<\/td>\s*<td[^>]*>[:\s]*<\/td>\s*<td[^>]*>(.*?)<\/td>/i);
    const mTotalSelisih = match(/Total Item Selisih<\/td>\s*<td[^>]*>[:\s]*<\/td>\s*<td[^>]*>(.*?)<\/td>/i);
    const mPersen = match(/Persentasi Ketidaksesuaian SO<\/td>\s*<td[^>]*>[:\s]*<\/td>\s*<td[^>]*>(.*?)<\/td>/i);

    const items = [];
    let grandTotalSelisihRupiah = 0;

    const tbody = html.match(/<table class="datatable"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);

    if (tbody) {
      const rows = [...tbody[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

      for (const row of rows) {
        const content = row[1];

        if (content.includes("TOTAL") || content.includes("border-top: 1px solid black")) {
          const totals = content.match(/<td[^>]*class="numeric_text"[^>]*>(.*?)<\/td>/gi);

          if (totals && totals.length >= 2) {
            const raw = cleanText(totals[totals.length - 1]);
            grandTotalSelisihRupiah = parseFloat(raw.replace(/,/g, "")) || 0;
          }
          continue;
        }

        const tds = [...content.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
          .map(m => cleanText(m[1]));

        if (tds.length >= 8) {
          const selisihRupiah = parseFloat(tds[7].replace(/,/g, "")) || 0;
          const stockFisik = parseFloat(tds[6].replace(/,/g, "")) || 0;

          items.push({
            no: items.length + 1,
            originalIndex: items.length,
            plu: tds[0],
            namaBarang: tds[1],
            conv1: tds[2],
            conv2: tds[3],
            subdept: tds[4],
            rack: tds[5],
            stockFisik,
            stockOhToko: stockFisik,
            plusMinus: 0,
            selisihRupiah,
            selisihRupiahRaw: tds[7],
            hasMutasi: false
          });
        }
      }
    }

    const itemsWithSelisih = items.filter(item => item.selisihRupiah !== 0);

    await runConcurrent(itemsWithSelisih, 8, async item => {
      try {
        const mutasi = await fetchMutasi(
          storeId,
          dateSo,
          item.plu,
          item.stockFisik
        );

        if (mutasi.found) {
          item.stockOhToko = mutasi.stockOh;
          item.plusMinus = mutasi.plusMinus;
          item.hasMutasi = true;
          item.mutasiDetail = mutasi;
        }
      } catch (error) {
        console.error("Mutasi error:", error.message);
      }
    });

    const totalItemSo =
      (mTotalSo && parseInt(cleanText(mTotalSo[1]), 10)) || items.length;

    const totalItemSelisih =
      (mTotalSelisih && parseInt(cleanText(mTotalSelisih[1]), 10)) ||
      itemsWithSelisih.length;

    const persentaseKetidaksesuaian = mPersen
      ? cleanText(mPersen[1])
      : totalItemSo > 0
        ? `${((totalItemSelisih / totalItemSo) * 100).toFixed(2)} %`
        : "0.00 %";

    return res.status(200).json({
      report: mReport ? cleanText(mReport[1]) : "PROSENTASE STOCK OPNAME",
      storeId,
      storeName: mToko ? cleanText(mToko[1]) : "",
      storeSubname: mTokoSub ? cleanText(mTokoSub[1]) : "",
      tanggalSo: mTanggalSo ? cleanText(mTanggalSo[1]) : dateSo,
      tanggalCetak: mTanggalCetak ? cleanText(mTanggalCetak[1]) : "",
      jenisSo: mJenisSo ? cleanText(mJenisSo[1]) : "SO REGULAR TOKO",
      totalItemSo,
      totalItemSelisih,
      persentaseKetidaksesuaian,
      grandTotalSelisihRupiah,
      items,
      rawHtmlPreview: html.slice(0, 1000)
    });
  } catch (error) {
    console.error("Error prosentase SO:", error);
    return res.status(500).json({
      error: "Terjadi kesalahan pada server",
      detail: error.message
    });
  }
}
