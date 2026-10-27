# Spesifikasi Kebutuhan Sistem: Normalisasi & Rekonsiliasi Sales vs Jurnal Finance

Dokumen ini mendokumentasikan spesifikasi teknis, aturan bisnis, dan alur pemrosesan data untuk pembangunan sistem normalisasi jurnal finance dan rekonsiliasi data transaksi penjualan (*sales report*) dengan jurnal keuangan (*journal entry*).

---

## 1. Ikhtisar Sistem (Overview)

Sistem ini memiliki dua fungsi utama:
1. **Normalisasi Data Jurnal Keuangan (*Data Cleaning / Normalization*)**:
   Melakukan pembersihan baris data transaksi pada file jurnal finance (`journal-entry-template-sales-report`) berdasarkan kriteria kanal dan metode pembayaran tertentu.
2. **Rekonsiliasi Transaksi (*Reconciliation Engine*)**:
   Mencocokkan dan memvalidasi keakuratan nilai moneter (khususnya `Totalperline` dan komponen ongkos kirim) antara file transaksi penjualan (`DAILY SALES REPORT UPDATE` / `template-sales-report`) dengan file jurnal finance secara otomatis menggunakan *composite key* unik.

---

## 2. Spesifikasi Data Input

| No | Tipe File | Nama File Sumber | Deskripsi & Format |
|---|---|---|---|
| 1 | **Sales Report (Harian/Master)** | `DAILY SALES REPORT UPDATE_261019 FH FHI (1).xlsx` / `template-sales-report (1).xlsx` | Berisi data detil transaksi penjualan baris per baris (*order line*). Kolom penting: `Entitas`, `Kanal`, `Group`, `MetodeBayar`, `Warehouse`, `Code SKU`, `Product Name`, `Quantity`, `Totalperline`, `Ongkir`, `DiscountOngkir`, `ShippingFee`. |
| 2 | **Journal Finance** | `journal-entry-template-sales-report (1).xlsx` | Berisi data jurnal keuangan dalam bentuk debit/kredit per akun akuntansi. Kolom penting: `Partner`, `Date`, `Payment Type`, `Journal`, `Company`, `Journal Items/Account`, `Journal Items/Label`, `Journal Items/Debit`, `Journal Items/Credit`. |

---

## 3. Modul 1: Normalisasi Data Jurnal Finance

### 3.1. Aturan Bisnis Pembersihan Baris
Pada file jurnal finance, baris jurnal untuk transaksi bertipe **`Bill`** akan dihapus beserta baris anak (*child*)-nya jika memenuhi **kedua kriteria berikut secara bersamaan**:
- **Kriteria 1**: Kolom `Partner` **TIDAK mengandung kata `SOSCOM`** (berasal dari mitra Non-SOSCOM seperti LAZADA, SHOPEE, TIKTOK SHOP).
- **Kriteria 2**: Kolom `Payment Type` / metode bayar **mengandung kata `COD`**.

### 3.2. Struktur Blok Transaksi `Bill`
Satu transaksi `Bill` terdiri dari **3 baris terurut**:
1. **Baris 1 (Header / Baris Induk `Bill`)**:
   - Kolom `Journal`: `Bill`
   - Kolom `Partner`: Terisi nama mitra (misal: `LAZADA Retail-MP`)
   - Kolom `Payment Type`: Terisi tipe pembayaran (misal: `COD`)
   - Kolom `Company`: Terisi nama perusahaan (misal: `PT Family Herbal Indonesia`)
   - Kolom `Journal Items/Debit`: Nilai debit (atau `Ongkir - DiscountOngkir`)
2. **Baris 2 (Child 1 - Biaya Promosi)**:
   - Kolom `Journal`, `Partner`, `Payment Type`: Bernilai kosong (`null`/`empty`)
   - Kolom `Journal Items/Account`: Akun Biaya Promo (misal: `60130130 Biaya Promo MP`)
   - Kolom `Journal Items/Debit`: Nilai debit diskon ongkir
3. **Baris 3 (Child 2 - Utang Ongkir)**:
   - Kolom `Journal`, `Partner`, `Payment Type`: Bernilai kosong (`null`/`empty`)
   - Kolom `Journal Items/Account`: `20120104 Utang Ongkir`
   - Kolom `Journal Items/Credit`: Nilai kredit total ongkir

> **Tindakan Sistem:**
> Jika Baris Induk `Bill` memenuhi kriteria (Non-SOSCOM & COD), maka **ketiga baris (Baris Induk + Child 1 + Child 2) wajib dihapus seluruhnya**.
> Transaksi Non-SOSCOM metode `TF` (Transfer) serta transaksi `SOSCOM` (baik `COD`, `NON COD`, maupun `TF`) **tetap dipertahankan**.

---

## 4. Modul 2: Struktur Akuntansi Transaksi `Bill` (2 Debit + 1 Kredit)

Untuk transaksi `Bill` yang dicatat pada jurnal, berlaku ketentuan komposisi **2 Debit dan 1 Kredit** yang seimbang (*balanced*):

$$\text{Debit}_1 + \text{Debit}_2 = \text{Kredit}$$

$$\underbrace{\text{Net Ongkir}}_{\text{Debit Baris 1}} + \underbrace{\text{Diskon Ongkir}}_{\text{Debit Baris 2}} = \underbrace{\text{Gross Ongkir}}_{\text{Kredit Baris 3}}$$

### 4.1. Formula Penentuan Komponen (Murni dari Kolom Ongkir & DiscountOngkir)
Perhitungan komponen baris `Bill` diambil **murni dari kolom `Ongkir` dan `DiscountOngkir`** dari file sales report (tanpa mengambil atau menggantikan dengan kolom `ShippingFee`):

$$\text{Gross Ongkir (Kredit)} = \text{Sales.Ongkir}$$
$$\text{Diskon Ongkir (Debit 2)} = \text{Sales.DiscountOngkir}$$
$$\text{Net Ongkir (Debit 1)} = \text{Sales.Ongkir} - \text{Sales.DiscountOngkir}$$

> **Catatan Akuntansi:**
> - Kolom `Ongkir` mencerminkan kewajiban tagihan bruto ke vendor ekspedisi (*Gross Shipping Payable*).
> - Kolom `DiscountOngkir` mencerminkan beban subsidi gratis ongkir yang ditanggung perusahaan (*Promotion Expense*).
> - `Ongkir - DiscountOngkir` mencerminkan ongkir riil yang dibebankan ke pembeli (*Net Receivable*).
> - Kolom `ShippingFee` **tidak digunakan** untuk perhitungan baris Bill ini karena merupakan potongan biaya administrasi platform marketplace, bukan utang ekspedisi perusahaan.

### 4.2. Rincian Pemetaan Komponen:
1. **Debit Baris 1 (Net Shipping Fee / Piutang atau Pendapatan Muka):**
   - **Formula:** $\text{Ongkir} - \text{DiscountOngkir}$
   - **Akun COA:** 
     - Transaksi SOSCOM $\rightarrow$ `20160001 Pendapatan diterima di muka`
     - Transaksi Marketplace (jika ada) $\rightarrow$ `10140101 Piutang Usaha`
2. **Debit Baris 2 (Diskon Ongkir / Biaya Promo Subsidi):**
   - **Formula:** $\text{DiscountOngkir}$
   - **Akun COA:** 
     - SOSCOM CRM $\rightarrow$ `60120003 Biaya Promo CRM`
     - SOSCOM Akuisisi $\rightarrow$ `60110090 Biaya Promo Akuisisi`
     - Marketplace $\rightarrow$ `60130130 Biaya Promo MP` / `60140012 Biaya Promo Tiktok`
3. **Kredit Baris 3 (Total Utang Ekspedisi):**
   - **Formula:** $\text{Ongkir}$ *(murni dari kolom Ongkir, bukan ShippingFee)*
   - **Akun COA:** `20120104 Utang Ongkir`

### 4.3. Fitur Pembuatan Jurnal Seimbang Otomatis (Auto-Balanced Generator)
Sistem menyediakan fitur pembuatan jurnal finance baru langsung dari data sales:
- Menyusun blok Invoices, Inventory Valuation, dan Bill secara otomatis.
- Menerapkan eliminasi otomatis untuk transaksi Non-SOSCOM COD.
- Menjamin setiap blok transaksi memenuhi validasi $\text{Debit} - \text{Kredit} = 0$.


---

## 5. Modul 3: Rekonsiliasi Data (Sales vs Finance Journal)

### 5.1. Kunci Acuan Pencocokan (Pola Roll-Up & Two-Tier Warehouse Breakdown)
Karena pada data jurnal saat ini belum terdapat identifikasi warehouse di dalam string label, sistem menerapkan strategi **Roll-Up Label Matching dengan Rincian Gudang (Two-Tier View)**:

#### 1. Pemetaan Entitas / Perusahaan:
| Kolom di Sales Report | Kolom di Journal Finance | Keterangan |
|---|---|---|
| `FHI` | `PT Family Herbal Indonesia` | Entitas legal Family Herbal Indonesia |
| `FH` | `PT Family Herbal` (atau entitas setara) | Entitas legal Family Herbal |

#### 2. Logika Pencocokan Level Utama (Tier 1 - Roll-Up Reconciliation):
Pencocokan primer dilakukan pada tingkat label dasar tanpa memecah gudang:
$$\mathbf{\{Kanal\}\ \{Group\}\ \{MetodeBayar\}\ |\ \{Code\ SKU\}\ \{Product\ Name\}}$$
- Di sisi Sales Report: Seluruh transaksi produk & kanal yang sama dijumlahkan total omsetnya lintas seluruh gudang (misal: Jakarta + Surabaya).
- Di sisi Journal Finance: Jika terdapat baris jurnal kembar dengan label yang sama (karena berasal dari gudang berbeda), nilai Debit baris-baris tersebut dijumlahkan secara otomatis.
- Manfaat: Menjamin validasi keuangan 100% akurat tanpa risiko benturan duplikasi (*duplicate keys*).

#### 3. Logika Rincian Gudang (Tier 2 - Warehouse Breakdown):
Sistem tetap menyimpan kontribusi data per gudang dari sisi sales report. Di antarmuka aplikasi:
- Setiap baris memiliki tombol interaktif `[▶]` atau badge `X Gudang ▾`.
- Pengguna dapat mengeklik baris tersebut untuk membuka kartu rincian per gudang (Omset, Kuantitas, dan Komposisi Ongkos Kirim per masing-masing gudang).
- Pada hasil ekspor Excel, disediakan sheet khusus bernama `Rincian Per Gudang`.


### 5.3. Aturan Validasi Rekonsiliasi
Sistem melakukan pengecekan selisih (*variance check*):
1. **Pengecekan Transaksi Penjualan (`Invoices`):**
   - Nilai $\sum(\text{Totalperline})$ dari sales report dibandingkan dengan:
     - Kolom `Journal Items/Debit` pada akun `Piutang Usaha`, ATAU
     - Kolom `Journal Items/Credit` pada akun `Pendapatan MP` (untuk invoice).
   - **Kondisi Valid:** Selisih $\le 0.01$ (toleransi pembulatan pecahan).
2. **Pengecekan Komponen Ongkir (`Bill`):**
   - Nilai $\sum(\text{ShippingFee})$ dari sales report dibandingkan dengan Debit Baris 1 pada jurnal `Bill`.
   - Nilai $\sum(\text{DiscountOngkir})$ dibandingkan dengan Debit Baris 2 (`Biaya Promo`).
   - Nilai $\sum(\text{Ongkir})$ dibandingkan dengan Kredit Baris 3 (`Utang Ongkir`).
   - *Catatan:* Untuk transaksi Non-SOSCOM COD yang telah dinormalisasi (dihapus), perbandingan ini dilewati (*bypass*).

---

## 6. Output Sistem & Laporan Rekonsiliasi

Sistem yang dibangun diharapkan menghasilkan:
1. **File Jurnal yang Ternormalisasi (`journal_normalized.xlsx`)**:
   File jurnal finance yang telah bersih dari baris `Bill` Non-SOSCOM COD beserta baris *child*-nya.
2. **Laporan Hasil Rekonsiliasi (`reconciliation_report.xlsx` / `.csv`)**:
   Berisi daftar perbandingan dengan status:
   - `MATCHED`: Nilai sales dan nilai jurnal sama persis.
   - `DISCREPANCY`: Nilai berbeda (tampilkan nilai sales, nilai jurnal, dan nilai selisih).
   - `MISSING_IN_JOURNAL`: Transaksi ada di sales report tetapi tidak ditemukan di jurnal finance.
   - `MISSING_IN_SALES`: Entri ada di jurnal finance tetapi tidak ditemukan pada data transaksi sales.

---

## 7. Catatan Implementasi Teknis (Technical Recommendations)

1. **Efisiensi Memori (File Harian ~96 MB)**:
   - File harian `DAILY SALES REPORT UPDATE` memiliki ukuran ~96 MB dengan ratusan ribu baris.
   - Gunakan pustaka berkinerja tinggi seperti `pandas` / `polars` dengan *chunking* atau `openpyxl (read_only=True)` saat membaca file Excel besar untuk mencegah *Out-Of-Memory* (OOM).
2. **Konsistensi Teks & Whitespace**:
   - Lakukan pembersihan string (*trimming* spasi dan standardisasi huruf kapital) saat menggabungkan kolom label: `Kanal`, `Group`, `MetodeBayar`, `SKU`, `Product`, dan `Warehouse`.
3. **Penyelarasan Tipe Data Numerik**:
   - Pastikan nilai angka yang kosong atau string strip (`"-"`) dikonversi secara aman menjadi `0.0`.
