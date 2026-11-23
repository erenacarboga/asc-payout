# Renders docs/demo.gif with made-up data: vhs docs/demo.tape (or the "Demo GIF" workflow)
Output docs/demo.gif
Set Shell bash
Set FontSize 15
Set Width 900
Set Height 800
Set Theme "Catppuccin Mocha"
Set Padding 18
Set TypingSpeed 45ms

Hide
Type "export PATH=$PWD/bin:$PATH && clear"
Enter
Show

Type "asc-payout demo -m 2026-10"
Sleep 400ms
Enter
Sleep 5s
Type "asc-payout demo -m $(date +%Y-%m)"
Sleep 400ms
Enter
Sleep 5s
