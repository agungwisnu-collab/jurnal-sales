Saya ingin membuat system untuk melakukan penghapusan baris data dan reconcile terkait total transaksi dari data penjualan dengan jurnal finance

File Daily Sales Report Update dan template-sales-report merupakan file transaksi penjualan
File journal-entry-template-sales-report merupakan file jurnal finance

Untuk proses normalisasi data adalah sebagai berikut
pada file journal-entry-template-sales-report akan dilakukan penghapusan baris data dengan kondisi kolom
 - partner tidak mengandung tulisa SOSCOM & payment method mengandung tulisan COD
 - maka baris bill pada kolom journal dihapus termasuk child dari baris bill tersebut

 untuk proses reconcile adalah sebagai berikut
bandingkan Totalperline dari file template-sales-report / Daily Sales Report Update dengan file journal-entry-template-sales-report menggunakan logic pencarian berikut
- pada journal-entry-template-sales-report terdapat 2 kolom acuan untuk pencarian data / reconcile data ke file sales adalah kolom Company dan Journal Items/Label
- kolom Company pada journal sama dengan kolom entitas pada daily dan template sales report
- kolom Journal Items/Label merupakan bagian dari banyak kolom pada file sales report, yaitu Kolom Kanal, Group, Metode Bayar, Product Name dan Warehouse (dengan format tambahan ` | {warehouse}`)
- Untuk transaksi Bill pada jurnal finance terdapat komposisi 2 Debit dan 1 Kredit:
  - Debit baris pertama: mengambil dari nilai `(Ongkir - DiscountOngkir)` dari file sales
  - Debit baris kedua: mengambil dari nilai `DiscountOngkir` dari file sales
  - Kredit baris ketiga: mengambil dari total `Ongkir` dari file sales

