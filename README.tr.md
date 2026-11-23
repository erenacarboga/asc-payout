# asc-payout

[English](README.md)

**Apple bu ay bana ne kadar ödeyecek?** `asc-payout` bunu kendi App Store Connect verinizden, Apple'ın mali aylarına göre hesaplar ve iki kaynağı yan yana gösterir:

- **Reports**: Apple'ın Financial Report'u. Kesin rakamdır, ödeme buna göre yapılır. Ay kapandıktan birkaç gün sonra yayınlanır.
- **Trends**: Ayın her günü için günlük Sales raporlarının toplamı. Ay devam ederken de görünür; ay sonu tahmini de verir.

Bir veya birden fazla hesap (ör. şirket ve bireysel) desteklenir. Her para birimi ay sonu kuruyla çevrilir.

Hesap olmadan denemek için: `asc-payout demo` (uydurma rakamlar).

## Kurulum

macOS ve Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.ps1 | iex
```

Repo gizliyken önce bir kez `gh auth login`, sonra:

```powershell
gh api repos/erenacarboga/asc-payout/contents/install.ps1 -H "Accept: application/vnd.github.raw" | Out-String | iex
```

```bash
gh api repos/erenacarboga/asc-payout/contents/install.sh -H "Accept: application/vnd.github.raw" | bash
```

Kurulum `asc-payout` komutunu PATH'e ekler: Windows'ta kullanıcı PATH'ine, macOS ve Linux'ta kabuğun ayar dosyasına (`~/.zshrc`, `~/.bashrc`, `~/.bash_profile` veya fish) bir satır yazarak (`ASC_PAYOUT_NO_MODIFY_PATH=1` ile kapatılabilir). Sonra yeni bir terminal açıp `asc-payout` yazmanız yeterli. Güncellemek için aynı komut tekrar çalıştırılır.

## Hesap ekleme

```
asc-payout setup
```

App Store Connect'ten iki şey gerekir:

1. **Finance rolü olan bir API anahtarı**: Users and Access > Integrations > App Store Connect API. `.p8` dosyasını indirin. Kurulum dosyayı İndirilenler klasöründe bulur, Key ID'yi dosya adından okur; siz sadece anahtar listesinin üstündeki Issuer ID'yi yapıştırırsınız.
2. **Vendor numarası**: Payments and Financial Reports sayfasının sol üstünde.

İkisi de kaydedilmeden önce Apple'da test edilir. İkinci bir hesap da aynı şekilde eklenir; aynı ekipteyse aynı anahtarı kullanabilir.

Tek anahtar yeterlidir: uygulama adları uygulama listesinden gelir, uygulama içi satın almalar uygulamalarına Sales raporları üzerinden bağlanır. App Manager rolünde ikinci bir anahtar isteğe bağlıdır.

## Kullanım

```
asc-payout                          hesap ve ay sorulur (varsayılan: son hesap, son kapanan ay)
asc-payout -a bireysel -m 2026-10   soru sormaz; hesap adının bir parçası yeterli
asc-payout -a all                   tüm hesaplar ve toplam tablo
asc-payout -m 2026-11 -c TRY        devam eden ay, TL olarak
asc-payout -a all --json            JSON çıktı
```

Program açılınca ekranı temizler; istemezseniz `--no-clear` (veya `ASC_PAYOUT_NO_CLEAR=1`).

Menüden seçilen ay ekranda kalır: **← →** önceki/sonraki ay, **↑ ↓** hesap değiştir (veya tüm hesaplar), **c** uygulamalar ile ülkeler arasında geçiş, **q** çıkış. `asc-payout history` son 12 ayı, aylık değişimi ve en çok kazandıran uygulamaları gösterir; `--by country` ülkelere göre listeler.

`2026-10` gibi bir ay, adını taşıdığı mali aydır: Ekim 2026 = 27 Eylül - 31 Ekim 2026.

Bir sorun olursa `asc-payout doctor` saati, anahtarları, her rapora erişimi, ağı ve önbelleği tek tek kontrol eder ve düzeltme yolunu yazar. `asc-payout update` en son sürümü kurar.

`asc-payout subs` aktif aboneleri (ödeyen, denemede, ödeme sorunlu), uygulama bazında MRR'ı ve son 30 günün denemelerini, ödemeye geçişlerini, yenilemelerini, iptallerini gösterir. `asc-payout history --year 2026 --csv` bir yılı tabloya aktarılacak şekilde verir. `asc-payout watch` geçen ayın Financial Report'u yayınlanınca bir kez masaüstü bildirimi gönderir; her sabah çalıştırmak için Windows'ta Görev Zamanlayıcı, macOS/Linux'ta cron kullanılabilir.

Bir şey yüklenirken ekranda hangi adımda olduğunu, günlük raporlar için ilerlemeyi ve geçen süreyi gösteren canlı bir satır görünür; iş bitince silinir.

## Hesaplama

- **Mali ay**: Apple'ın mali yılı Eylül'ün son cumartesi biter; çeyrekler 5, 4 ve 4 haftadır, 53 haftalık yıllarda fazla hafta Aralık'a eklenir. Financial Report varsa tarihler rapordan alınır.
- **Reports**: `Extended Partner Share`, `Partner Share Currency` bazında toplanır ve raporun sonundaki ülke özetiyle karşılaştırılır.
- **Trends**: Her günün raporunda `Units × Developer Proceeds` toplanır; iadeler negatif adetle düşer. Henüz yayınlanmamış günler ile satış olmayan günler ayrılır, okunamayan günler sıfır sayılmaz, listelenir.
- **Farkın kesin açıklaması**: Financial Detail raporundaki işlem tarihleriyle fark ikiye ayrılır: aydan önce yapılıp bu raporda ödenen satışlar ve bu ayın bir sonraki rapora kalan satışları; ikisi farkı kuruşu kuruşuna verir.
- **Tahmin**: Devam eden ayda şu ana kadarki satış + kalan günler × son 7 günün ortalaması.
- **Kurlar**: İki sütun da ayın son günündeki kurla çevrilir (ECB; ECB'de olmayanlar için exchange-api ve open.er-api). Kuru bulunamayan tutar ayrıca listelenir, asla 1:1 sayılmaz.
- **Fark**: Normal bir ayda Reports ile Trends birkaç yüzde farklıdır; ay sınırındaki satışlar komşu aya, iadeler farklı tarihe düşebilir, bazı düzeltmeler sadece Reports'ta görünür.
- **Yarım iş kullanılmaz**: İndirilen raporlar önbelleğe tek adımda yazılır ve her kullanımda kendi satır sayısı veya toplamlarıyla kontrol edilir; bozuk dosya silinip yeniden indirilir.
- **Her seferinde aynı sonuç**: Geçmiş bir günün kurları saklanır; kapanmış bir ay internet olmadan da hep aynı toplamı verir.
- **Ödeme**: Ay bitiminden yaklaşık 33 gün sonra. Tutarlar vergi kesintisi ve banka masrafı öncesidir.

## Gizlilik

Sadece bilgisayarınızda çalışır; kur servislerine yalnızca para birimi kodu ve tarih gider, telemetri yoktur. Ayarlar ve anahtarlar `~/.config/asc-payout` klasöründedir (`asc-payout status` tam yolu gösterir). Bu klasörü kopyalayarak kurulumu başka bilgisayara taşıyabilirsiniz; içinde API anahtarlarınız olduğu için gizli tutun.

## Lisans

MIT. Apple ile bağlantılı değildir.
