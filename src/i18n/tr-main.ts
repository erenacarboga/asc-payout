/** Turkish texts, by their English original. */
export const TR_MAIN: Record<string, string> = {
  // Home menu
  "What would you like to see?": "Ne görmek istersiniz?",
  "Update asc-payout": "asc-payout'u güncelle",
  "This month so far": "Bu ay şimdiye kadar",
  "Last month": "Geçen ay",
  "Another month…": "Başka bir ay…",
  "History…": "Geçmiş…",
  "months side by side, top apps": "aylar yan yana, en iyi uygulamalar",
  "Subscriptions…": "Abonelikler…",
  "paying, trials, MRR": "ödeyenler, denemeler, MRR",
  "Refunds and cancellations…": "İadeler ve iptaller…",
  "who leaves, why, trial conversion": "kim ayrılıyor, neden, deneme dönüşümü",
  "Profit after Apple Ads…": "Apple Ads sonrası kâr…",
  "revenue, ad spend, ROAS by app": "uygulama bazında gelir, reklam harcaması, ROAS",
  "connect Apple Ads to see it": "görmek için Apple Ads'i bağlayın",
  "Export to a file…": "Dosyaya aktar…",
  "CSV for Excel, Numbers, Google Sheets": "Excel, Numbers, Google Sheets için CSV",
  "Account": "Hesap",
  "Settings": "Ayarlar",
  "accounts, goals, Apple Ads, language, updates": "hesaplar, hedefler, Apple Ads, dil, güncellemeler",
  "Check my setup": "Kurulumumu kontrol et",
  "keys, access, clock, network": "anahtarlar, erişim, saat, ağ",
  "Quit": "Çık",
  "running": "sürüyor",
  "Start asc-payout again to use the new version.": "Yeni sürümü kullanmak için asc-payout'u yeniden başlatın.",

  // First run
  "Welcome to asc-payout": "asc-payout'a hoş geldiniz",
  "See what Apple will pay you, per fiscal month, from your App Store Connect data.":
    "App Store Connect verilerinizden Apple'ın size her mali ay ne ödeyeceğini görün.",
  "How do you want to start?": "Nasıl başlamak istersiniz?",
  "Set up my account": "Hesabımı kur",
  "an API key with the Finance role and your vendor number": "Finans rolü olan bir API anahtarı ve satıcı numaranız",
  "Look around with demo data": "Demo verisiyle göz at",
  "made-up numbers, nothing to set up": "örnek rakamlar, kurulum gerekmez",

  // Accounts
  "No account set up yet. Run: asc-payout setup": "Henüz hesap kurulmadı. Kurmak için: asc-payout setup",
  "No App Store Connect account is set up yet.": "Henüz bir App Store Connect hesabı kurulmadı.",
  "Set one up now?": "Şimdi kurmak ister misiniz?",
  'No account "{name}". Accounts: {list}, or "all".': '"{name}" adında bir hesap yok. Hesaplar: {list} ya da "all".',
  "Several accounts are set up: choose one with --account <name> or --account all":
    "Birden fazla hesap kurulu: --account <name> ya da --account all ile seçin",
  "All accounts": "Tüm hesaplar",
  "Show which account?": "Hangi hesap gösterilsin?",
  "vendor {vendor}": "satıcı {vendor}",
  "each account and a combined table": "her hesap ayrı ve birleşik tablo",

  // Month screen keys
  "month": "ay",
  "account": "hesap",
  "apps": "uygulamalar",
  "countries": "ülkeler",
  "app details": "uygulama ayrıntıları",
  "profit": "kâr",
  "reload": "yenile",
  "export": "dışa aktar",
  "back": "geri",
  "quit": "çık",
  "Saved {path}": "Kaydedildi: {path}",
  "Which app?": "Hangi uygulama?",
  "{app} · details": "{app} · ayrıntılar",

  // Pickers
  "Which month?": "Hangi ay?",
  "History of": "Hangi dönemin geçmişi?",
  "The last 12 months": "Son 12 ay",
  "The last 24 months": "Son 24 ay",
  "This year ({year})": "Bu yıl ({year})",
  "Another year…": "Başka bir yıl…",
  "Which year?": "Hangi yıl?",
  "Subscriptions, with events of": "Abonelikler, hangi dönemin olaylarıyla?",
  "Refunds and cancellations of": "Hangi dönemin iadeleri ve iptalleri?",
  "The last 7 days": "Son 7 gün",
  "The last 30 days": "Son 30 gün",
  "The last 90 days": "Son 90 gün",
  "{year} has not started yet": "{year} yılı henüz başlamadı",

  // Export
  "Save as a spreadsheet (CSV) in your Downloads folder": "İndirilenler klasörüne tablo (CSV) olarak kaydedin",
  "Subscriptions": "Abonelikler",
  "Refunds and cancellations (30 days)": "İadeler ve iptaller (30 gün)",

  // Apple Ads
  "Apple Ads is not connected. Connect it in Settings > Apple Ads (run: asc-payout setup).":
    "Apple Ads bağlı değil. Ayarlar > Apple Ads bölümünden bağlayın (komut: asc-payout setup).",

  // Prompts
  "← Back": "← Geri",
  "↑ more": "↑ daha fazla",
  "↓ more": "↓ daha fazla",
  "↑↓ move": "↑↓ gez",
  "enter select": "enter seç",
  "esc back": "esc geri",
  "q quit": "q çık",
  "enter confirm": "enter onayla",
  "tab fill": "tab doldur",
  "Not valid": "Geçersiz",
  "Yes": "Evet",
  "No": "Hayır",

  // Spinner
  "Starting": "Başlıyor",

  // Watch
  "{account}: {month} already announced.": "{account}: {month} zaten bildirildi.",
  "{account}: {month} not published yet.": "{account}: {month} henüz yayınlanmadı.",
  "{month} is final: {amount}, expected around {date}.": "{month} kesinleşti: {amount}, ödeme tahminen {date} civarında.",

  // Update
  "asc-payout {version} is available: run  asc-payout update": "asc-payout {version} çıktı: güncellemek için  asc-payout update",
  "Running from source: update with git pull.": "Kaynak koddan çalışıyor: git pull ile güncelleyin.",
  "Could not find the latest release (offline, or a private repository without the GitHub CLI).":
    "En son sürüm bulunamadı (çevrimdışı ya da GitHub CLI olmadan özel bir depo).",
  "asc-payout {version} is up to date.": "asc-payout {version} güncel.",
  "No release build for {platform} {arch}.": "{platform} {arch} için sürüm derlemesi yok.",
  "Updating {from} -> {to}...": "Güncelleniyor: {from} -> {to}...",
  "Checksum does not match; nothing was changed.": "Sağlama toplamı uyuşmuyor; hiçbir şey değiştirilmedi.",
  "Updated to {version}.": "Güncellendi: {version}.",
  "Download failed. For a private repository, install the GitHub CLI and run: gh auth login":
    "İndirme başarısız. Özel bir depo için GitHub CLI'ı kurun ve şunu çalıştırın: gh auth login",

  // Command line
  "setup needs an interactive terminal": "setup için etkileşimli bir terminal gerekir",
  '--month expects YYYY-MM, e.g. 2026-10 (got "{value}")': '--month YYYY-MM biçiminde olmalı, ör. 2026-10 (girilen: "{value}")',
  "--month expects YYYY-MM, e.g. 2026-10": "--month YYYY-MM biçiminde olmalı, ör. 2026-10",
  "{flag} needs a value": "{flag} için bir değer gerekli",
  "--year expects a year like 2026": "--year bir yıl bekler, ör. 2026",
  "--days expects a number from 1 to 365": "--days 1 ile 365 arasında bir sayı bekler",
  "--months expects a number from 1 to 36": "--months 1 ile 36 arasında bir sayı bekler",
  '--by expects "app" or "country"': '--by "app" ya da "country" bekler',
  "{flag} does not take a value": "{flag} değer almaz",
  "Unknown option: {name}": "Bilinmeyen seçenek: {name}",
  "Unknown command: {name}": "Bilinmeyen komut: {name}",
  "choose --json or --csv, not both": "--json ya da --csv seçin, ikisini birden değil",
  "--currency expects a 3-letter code like USD, EUR or TRY": "--currency USD, EUR ya da TRY gibi 3 harfli bir kod bekler",
  "Error: {message}": "Hata: {message}",
  "See: asc-payout --help": "Yardım: asc-payout --help",
};
