# asc-payout

[![Release](https://img.shields.io/github/v/release/erenacarboga/asc-payout)](https://github.com/erenacarboga/asc-payout/releases/latest) [![CI](https://github.com/erenacarboga/asc-payout/actions/workflows/ci.yml/badge.svg)](https://github.com/erenacarboga/asc-payout/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md)

**Apple bu ay bana ne kadar ödeyecek?** `asc-payout` bunu kendi App Store Connect verinizden, Apple'ın mali aylarına göre hesaplar ve iki kaynağı yan yana gösterir:

- **Raporlar** (Reports): Apple'ın Finansal Raporu (Financial Report). Kesin rakamdır, ödeme buna göre yapılır. Ay kapandıktan birkaç gün sonra yayınlanır.
- **Trendler** (Trends): Ayın her günü için günlük Satış raporlarının toplamı. Ay devam ederken de görünür: şu ana kadarki gerçek satış.

Bir veya birden fazla geliştirici hesabı desteklenir. Her para birimi ay sonu kuruyla çevrilir. Ayrıca: uygulama ayrıntıları, iadeler ve iptaller, Apple Ads sonrası kâr, aylık hedefler. Menüler ve ekranlar Türkçe.

Hesap olmadan denemek için: `asc-payout demo` (uydurma rakamlar).

![asc-payout demo](docs/demo.gif)

## Kurulum

macOS ve Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/erenacarboga/asc-payout/main/install.ps1 | iex
```

Kurulum `asc-payout` komutunu PATH'e ekler: Windows'ta kullanıcı PATH'ine, macOS ve Linux'ta kabuğun ayar dosyasına (`~/.zshrc`, `~/.bashrc`, `~/.bash_profile` veya fish) bir satır yazarak. `ASC_PAYOUT_NO_MODIFY_PATH=1` verilirse PATH'e dokunmaz. Sonra yeni bir terminal açıp `asc-payout` ya da kısaca `ascp` yazmanız yeterli (ikisi aynı program).

**Güncellemeler:** yeni bir sürüm çıktığında `asc-payout` açılırken şimdi güncellenip güncellenmeyeceğini sorar (evet, şimdi değil veya bu sürümü atla); evet derseniz kendini günceller, indirilenin SHA-256'sını kontrol eder ve yeni sürümle yeniden açılır. `asc-payout update` aynısını sormadan yapar; kurulum komutunu tekrar çalıştırmak da olur. Betiklerde, `--json`, `--csv` ve `watch` ile hiç sorulmaz (`ASC_PAYOUT_NO_UPDATE_CHECK=1` kontrolü kapatır).

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

`asc-payout` (veya `ascp`) yazın. Bir menü açılır; aracın yapabildiği her şey içindedir, parametre bilmeye gerek yoktur: bu ay, geçen ay, başka bir ay, geçmiş, abonelikler, iadeler ve iptaller, Apple Ads sonrası kâr, dosyaya aktarma (Excel için CSV), hesap seçimi, ayarlar (hesaplar, para birimi, aylık hedefler, Apple Ads, dil, bildirimler, güncellemeler) ve kurulum kontrolü.

Ok tuşları ve Enter ya da öğenin önündeki harf. **Esc** her yerde bir adım geri götürür; hesap eklerken de. Bir ay ekranındayken: **← →** önceki/sonraki ay, **↑ ↓** başka hesap, **c** ülkeler, **d** bir uygulamanın ayrıntıları, **p** Apple Ads sonrası kâr, **r** yeniden indir, **e** CSV olarak kaydet, **b** geri, **q** çıkış.

### Uygulama ayrıntıları

Bir ay ekranında **d**'ye basıp bir uygulama seçin: ürünleri, gün gün satışları, iadeleri (adet, tutar ve satılanlara oranı) ve kazandığı ülkeler.

### İadeler ve iptaller

`asc-payout churn` (menüde *İadeler ve iptaller…*), son 7, 30 veya 90 gün için uygulama bazında: başlayan denemeler ve bunlardan kaçının ödemeye geçtiği, iptaller ve nedenleri (Apple'ın verdiği neden), ödeme sorunları ve Apple'ın kurtardıkları, iadeler ve iade oranı. Denemeden ödemeye geçiş haftalık olarak da gösterilir.

### Aylık hedefler

Ayarlar > Aylık hedefler: her hesap için ve tüm hesaplar için birer hedef, istediğiniz para biriminde. Ay ekranı, şu ana kadarki gerçek satışa göre hedefin ne kadarına ulaştığınızı gösterir:

```
  Hedef     ██████████████░░  85%  $851,12 / $1.000,00  ·  $148,88 kaldı
```

### Apple Ads sonrası kâr

`asc-payout profit` (menüde *Apple Ads sonrası kâr…* veya ay ekranında **p**) her uygulamanın gelirini, Apple Ads kampanyalarının aynı günlerdeki harcamasının yanına koyar: kâr, ROAS, yükleme ve yükleme başına maliyet. Gelir, Apple'ın o ay için ödediği tutardır (Raporlar, yoksa Trendler); reklamsız satışları da içerir, yani buradaki ROAS gelir / reklam harcamasıdır.

Ayarlar > Apple Ads'den bir kez bağlanır:

1. Apple Ads > Hesap Ayarları > Kullanıcı Yönetimi'nden API rolü olan bir kullanıcı davet edin (API Account Read Only yeterli) ve o kullanıcıyla giriş yapın.
2. asc-payout'ta *Benim için yeni bir anahtar oluştur*'u seçin: anahtar çiftini oluşturur, özel anahtarı ayarlar klasörünüzde saklar ve açık anahtarı panoya kopyalar.
3. Apple Ads > Hesap Ayarları > API'de açık anahtarı yapıştırıp kaydedin. Gösterilen Client ID, Team ID ve Key ID'yi asc-payout'a girin; kaydetmeden önce Apple'da kontrol edilir.

Elinizde özel anahtar (.pem) varsa *Zaten bir özel anahtar dosyam var*'ı seçin.

### Dil

Menüler ve ekranlar sistem diline göre Türkçe veya İngilizcedir. Ayarlar > Dil'den değiştirilebilir; tek bir çalıştırma için `ASC_PAYOUT_LANG=tr` veya `ASC_PAYOUT_LANG=en`. `--json`, `--csv` ve `--help` her zaman İngilizcedir.

Betikler için aynı şeyler parametrelerle de yapılabilir:

```
asc-payout                          hesap ve ay sorulur (varsayılan: son hesap, son kapanan ay)
asc-payout -a "hesap 2" -m 2026-10   soru sormaz; hesap adının bir parçası yeterli
asc-payout -a all                   tüm hesaplar ve toplam tablo
asc-payout -m 2026-11 -c TRY        devam eden ay, TL olarak
asc-payout -a all --json            JSON çıktı
```

Program açılınca ekranı temizler; istemezseniz `--no-clear` (veya `ASC_PAYOUT_NO_CLEAR=1`).

Menüden seçilen ay ekranda kalır: **← →** önceki/sonraki ay, **↑ ↓** hesap değiştir (veya tüm hesaplar), **c** uygulamalar ile ülkeler arasında geçiş, **q** çıkış. `asc-payout history` son 12 ayı, aylık değişimi ve en çok kazandıran uygulamaları gösterir; `--by country` ülkelere göre listeler.

`2026-10` gibi bir ay, adını taşıdığı mali aydır: Ekim 2026 = 27 Eylül - 31 Ekim 2026.

Bir sorun olursa `asc-payout doctor` saati, anahtarları, her rapora erişimi, ağı ve önbelleği tek tek kontrol eder ve düzeltme yolunu yazar. `asc-payout update` en son sürümü kurar.

`asc-payout churn --days 90` iadeleri, iptalleri ve haftalık deneme dönüşümünü; `asc-payout profit -m 2026-10` uygulama bazında gelir, reklam harcaması, kâr ve ROAS'ı verir.

`asc-payout subs` aktif aboneleri (ödeyen, denemede, ödeme sorunlu), uygulama bazında MRR'ı (dönem başına eline geçen tutar: haftalık × 4,35, yıllık ÷ 12; peşin ödenen teklifler ödeyen sayılır ama kaç ayı kapsadığı raporda olmadığı için MRR'a katılmaz) ve son 30 günün denemelerini, ödemeye geçişlerini, yenilemelerini, iptallerini gösterir. `asc-payout history --year 2026 --csv` bir yılı tabloya aktarılacak şekilde verir. `asc-payout watch` geçen ayın Financial Report'u yayınlanınca bir kez masaüstü bildirimi gönderir; her sabah çalıştırmak için Windows'ta Görev Zamanlayıcı, macOS/Linux'ta cron kullanılabilir.

Bir şey yüklenirken ekranda hangi adımda olduğunu, günlük raporlar için ilerlemeyi ve geçen süreyi gösteren canlı bir satır görünür; iş bitince silinir.

## Yapay zekâ asistanından kullanma

Normal cümlelerle, istediğiniz dilde sorun: *"Apple Ekim için bana ne kadar ödeyecek?"*, *"bu ay en çok iade hangi uygulamada?"*, *"Apple Ads kâr ettiriyor mu?"*. İki yolu var, ikisi de bilgisayarınızda ve kurduğunuz hesaplarla (`asc-payout setup`) çalışır; anahtarlarınız bilgisayardan çıkmaz, sohbete sadece sonuçlar gider.

### Claude Desktop: uzantı

1. asc-payout'u kurun ve bir kez `asc-payout setup` çalıştırın (bkz. [Kurulum](#kurulum)).
2. [asc-payout.mcpb](https://github.com/erenacarboga/asc-payout/releases/latest/download/asc-payout.mcpb) dosyasını indirip açın: Claude Desktop uzantıyı kurmayı önerir. (Ya da Ayarlar > Uzantılar > Uzantı Yükle.)
3. Herhangi bir sohbette sorun. Claude uzantının araçlarını kullanır: hesaplar, bir ay, geçmiş, abonelikler, iadeler ve iptaller, Apple Ads sonrası kâr.

Uzantı, kurulu `asc-payout`'u `asc-payout mcp` ile başlatır. Bulamazsa Claude size nasıl kuracağınızı söyler; alışılmadık bir yerdeyse yolunu uzantının ayarlarından verebilirsiniz. Uzantı bağlanamazsa kaydı geçici klasördeki `asc-payout-extension.log` dosyasındadır (Windows: `%TEMP%`).

### Her MCP istemcisi: `asc-payout mcp`

`asc-payout mcp`, aynı araçları sunan bir [Model Context Protocol](https://modelcontextprotocol.io) sunucusudur (stdio). Barındırılacak bir sunucu yoktur: asistan gerektiğinde bilgisayarınızda kendisi başlatır.

- **Claude Code:** `claude mcp add asc-payout -- asc-payout mcp`
- **VS Code:** `.vscode/mcp.json` içinde (veya kullanıcı MCP ayarlarında): `{ "servers": { "asc-payout": { "type": "stdio", "command": "asc-payout", "args": ["mcp"] } } }`
- **Cursor** ve diğerleri: `{ "mcpServers": { "asc-payout": { "command": "asc-payout", "args": ["mcp"] } } }`

### Agent Skill

Komut çalıştırabilen kodlama asistanları için depoda bir [Agent Skill](skills/asc-payout/SKILL.md) de var. Aynı soruları `asc-payout`'u `--json` ile çalıştırıp sonucu doğru okuyarak (mali aylar, Raporlar ve Trendler, şu ana kadarki satış ile kesin ödemenin farkı) cevaplamayı öğretir. Anahtarlarınızı asla okumaz ve göstermez.

**Claude Code**, eklenti olarak:

```
/plugin marketplace add erenacarboga/asc-payout
/plugin install asc-payout@asc-payout
```

**VS Code (GitHub Copilot), Cursor, Codex ve Agent Skills okuyan diğer araçlar:** `skills/asc-payout` klasörünü aracın skill klasörüne kopyalayın:

| Araç | Klasör (tüm projeler) | Klasör (tek proje) |
|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| VS Code (GitHub Copilot) | `~/.copilot/skills/` | `.github/skills/` |
| Codex, Cursor | `~/.agents/skills/` | `.agents/skills/` |

Örneğin Windows'ta VS Code için (PowerShell):

```powershell
$d = "$HOME\.copilot\skills\asc-payout"; New-Item -ItemType Directory -Force "$d\references" | Out-Null
irm https://raw.githubusercontent.com/erenacarboga/asc-payout/main/skills/asc-payout/SKILL.md -OutFile "$d\SKILL.md"
irm https://raw.githubusercontent.com/erenacarboga/asc-payout/main/skills/asc-payout/references/json-output.md -OutFile "$d\references\json-output.md"
```

macOS ve Linux'ta:

```bash
mkdir -p ~/.copilot/skills/asc-payout/references
curl -fsSL https://raw.githubusercontent.com/erenacarboga/asc-payout/main/skills/asc-payout/SKILL.md -o ~/.copilot/skills/asc-payout/SKILL.md
curl -fsSL https://raw.githubusercontent.com/erenacarboga/asc-payout/main/skills/asc-payout/references/json-output.md -o ~/.copilot/skills/asc-payout/references/json-output.md
```

Sonra normal cümlelerle sorun. Hesap kurulumu size kalır: kendi terminalinizde bir kez `asc-payout setup` çalıştırın.

## Hesaplama

- **Mali ay**: Apple'ın mali yılı Eylül'ün son cumartesi biter; çeyrekler 5, 4 ve 4 haftadır, 53 haftalık yıllarda fazla hafta Aralık'a eklenir. Financial Report varsa tarihler rapordan alınır.
- **Reports**: `Extended Partner Share`, `Partner Share Currency` bazında toplanır ve raporun sonundaki ülke özetiyle karşılaştırılır.
- **Trends**: Her günün raporunda `Units × Developer Proceeds` toplanır; iadeler negatif adetle düşer. Henüz yayınlanmamış günler ile satış olmayan günler ayrılır, okunamayan günler sıfır sayılmaz, listelenir.
- **Farkın kesin açıklaması**: Financial Detail raporundaki işlem tarihleriyle fark ikiye ayrılır: aydan önce yapılıp bu raporda ödenen satışlar ve bu ayın bir sonraki rapora kalan satışları; ikisi farkı kuruşu kuruşuna verir.
- **Sadece gerçek rakamlar, tahmin yok**: Ay devam ederken şu ana kadarki satış (Apple yayınladıkça gün gün Trendler) gösterilir ve ödemenin henüz kesin olmadığı yazılır. Ödeme tutarı Apple'ın Finansal Raporu'dur; Apple yayınlayınca gösterilir. Ortalamadan ay sonu tahmini yapılmaz.
- **Kurlar**: İki sütun da ayın son günündeki kurla çevrilir (ECB; ECB'de olmayanlar için exchange-api ve open.er-api). Kuru bulunamayan tutar ayrıca listelenir, asla 1:1 sayılmaz.
- **Fark**: Normal bir ayda Reports ile Trends birkaç yüzde farklıdır; ay sınırındaki satışlar komşu aya, iadeler farklı tarihe düşebilir, bazı düzeltmeler sadece Reports'ta görünür.
- **Yarım iş kullanılmaz**: İndirilen raporlar önbelleğe tek adımda yazılır ve her kullanımda kendi satır sayısı veya toplamlarıyla kontrol edilir; bozuk dosya silinip yeniden indirilir.
- **Her seferinde aynı sonuç**: Geçmiş bir günün kurları saklanır; kapanmış bir ay internet olmadan da hep aynı toplamı verir.
- **Ödeme**: Ay bitiminden yaklaşık 33 gün sonra. Tutarlar vergi kesintisi ve banka masrafı öncesidir.

## Gizlilik

Sadece bilgisayarınızda çalışır; anahtarlarınızla yalnızca App Store Connect'e (bağladıysanız Apple Ads'e de) bağlanır, kur servislerine yalnızca para birimi kodu ve tarih gider, telemetri yoktur. Ayarlar ve anahtarlar `~/.config/asc-payout` klasöründedir (`asc-payout status` tam yolu gösterir). Bu klasörü kopyalayarak kurulumu başka bilgisayara taşıyabilirsiniz; içinde API anahtarlarınız olduğu için gizli tutun.

## Lisans

MIT. Apple ile bağlantılı değildir.
