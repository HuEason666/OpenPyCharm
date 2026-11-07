/**
 * IntelliJ (Windows/Linux) keymap preset. Format: `Record<actionId, string[]>`
 * — modifiers joined with `+`, `"Shift Shift"` = double-tap, keys matched by
 * physical position (`event.code`).
 */
export const INTELLIJ_WINDOWS: Record<string, string[]> = {
  // Navigate
  "navigate.searchEverywhere": ["Shift Shift"],
  "navigate.gotoFile": ["Ctrl+Shift+N"],
  "navigate.gotoClass": ["Ctrl+N"],
  "navigate.gotoLine": ["Ctrl+G"],
  "navigate.recentFiles": ["Ctrl+E"],
  "navigate.findAction": ["Ctrl+Shift+A"],
  "navigate.fileStructure": ["Ctrl+F12"],
  "navigate.declaration": ["Ctrl+B"],
  "navigate.implementation": ["Ctrl+Alt+B"],
  "navigate.nextError": ["F2"],
  "navigate.prevError": ["Shift+F2"],
  "navigate.filePath": ["Ctrl+Alt+F12"],
  "navigate.back": ["Ctrl+Alt+Left"],
  "navigate.forward": ["Ctrl+Alt+Right"],

  // Find
  "find.inFile": ["Ctrl+F"],
  "find.replaceInFile": ["Ctrl+R"],
  "find.inPath": ["Ctrl+Shift+F"],

  // Editor
  "editor.closeTab": ["Ctrl+F4"],
  "editor.nextTab": ["Alt+Right"],
  "editor.prevTab": ["Alt+Left"],
  "editor.escape": ["Escape"],
  "editor.copyPath": ["Ctrl+Shift+C"],

  // Code
  "code.commentLine": ["Ctrl+Slash"],
  "code.blockComment": ["Ctrl+Shift+Slash"],
  "code.duplicateLine": ["Ctrl+D"],
  "code.deleteLine": ["Ctrl+Y"],
  "code.moveLineUp": ["Alt+Shift+Up"],
  "code.moveLineDown": ["Alt+Shift+Down"],
  "code.reformat": ["Ctrl+Alt+L"],
  "code.autoIndent": ["Ctrl+Alt+I"],
  "code.selectExpand": ["Ctrl+W"],
  "code.selectShrink": ["Ctrl+Shift+W"],

  // Refactor
  "refactor.rename": ["Shift+F6"],

  // Files
  "file.open": ["Ctrl+O"],
  "file.new": ["Alt+Insert"],
  "file.saveAll": ["Ctrl+S"],
  "file.settings": ["Ctrl+Alt+S"],

  // Tool windows
  "toolwindow.project": ["Alt+1"],
  "toolwindow.find": ["Alt+3"],
  "toolwindow.run": ["Alt+4"],
  "toolwindow.problems": ["Alt+6"],
  "toolwindow.structure": ["Alt+7"],
  "toolwindow.terminal": ["Alt+F12"],
  "toolwindow.git": ["Alt+9"],
  "toolwindow.hideAll": ["Ctrl+Shift+F12"],
  "toolwindow.hideActive": ["Shift+Escape"],
  "toolwindow.maximize": ["Ctrl+Shift+Quote"],

  // Run
  "run.run": ["Shift+F10"],
  "run.debug": ["Shift+F9"],
  "run.stop": ["Ctrl+F2"],
  "run.runContext": ["Ctrl+Shift+F10"],
  "run.chooseConfig": ["Alt+Shift+F10"],

  // Debugger
  "debug.resume": ["F9"],
  "debug.pause": ["Ctrl+F9"],
  "debug.stepOver": ["F8"],
  "debug.stepInto": ["F7"],
  "debug.stepOut": ["Shift+F8"],
  "debug.toggleLineBreakpoint": ["Ctrl+F8"],
  "toolwindow.debug": ["Alt+5"],

  // Terminal
  "terminal.new": ["Ctrl+Shift+T"],

  // VCS
  "vcs.commit": ["Ctrl+K"],
  "vcs.push": ["Ctrl+Shift+K"],
  "vcs.pull": ["Ctrl+T"],

  // View
  "view.welcome": ["Ctrl+Shift+O"],

  // Help
  "help.about": [],
};
