# Renders docs/demo.gif with made-up data: vhs docs/demo.tape (or the "Demo GIF" workflow).
# No account is set up on the runner, so asc-payout starts with its welcome menu.
Output docs/demo.gif
Set Shell bash
Set FontSize 15
Set Width 1060
Set Height 820
Set Theme "Catppuccin Mocha"
Set Padding 18
Set TypingSpeed 45ms

Hide
Type "export PATH=$PWD/bin:$PATH ASC_PAYOUT_LANG=en && clear"
Enter
Show

Type "asc-payout"
Sleep 400ms
Enter
Sleep 2s
Down
Sleep 600ms
Enter
Sleep 5s
Type "b"
Sleep 1500ms
Type "q"
Sleep 1s
Type "asc-payout demo -m $(date +%Y-%m)"
Sleep 400ms
Enter
Sleep 5s
