#!/usr/bin/env node
/**
 * Generates static shell completion files into dist/completions/
 * Run automatically during `prepack` before publishing to npm.
 *
 * Output:
 *   dist/completions/aiex.bash   → source <(cat node_modules/.bin/../aiex-cli/dist/completions/aiex.bash)
 *   dist/completions/aiex.zsh    → #compdef style, place in $fpath
 *   dist/completions/aiex.fish   → place in ~/.config/fish/completions/
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'dist', 'completions')

// ── Inline the template functions (avoid importing unbuilt TS) ──

const name = 'aiex'

function bashScript() {
  return `# ${name} bash completion
# Install: source <(${name} completion bash)
# Permanent: ${name} completion bash > /etc/bash_completion.d/${name}
_${name}() {
  local IFS=$'\\n'
  COMPREPLY=($(${name} _complete "\${COMP_WORDS[@]}" 2>/dev/null))
}
complete -F _${name} ${name}
`
}

function zshScript() {
  return `# ${name} zsh completion
# Install (dynamic): source <(${name} completion zsh)
# Permanent: ${name} completion zsh > "\${fpath[1]}/_${name}"
#compdef ${name}

_${name}() {
  local -a completions
  completions=("\${(@f)$(${name} _complete "\${words[@]}" 2>/dev/null)}")
  _describe '${name}' completions
}
compdef _${name} ${name}
`
}

function fishScript() {
  return `# ${name} fish completion
# Install: ${name} completion fish | source
# Permanent: ${name} completion fish > ~/.config/fish/completions/${name}.fish
complete -c ${name} -f -a '(${name} _complete (commandline -cp) 2>/dev/null)'
`
}

fs.mkdirSync(outDir, { recursive: true })

fs.writeFileSync(path.join(outDir, `${name}.bash`), bashScript(), 'utf-8')
fs.writeFileSync(path.join(outDir, `${name}.zsh`), zshScript(), 'utf-8')
fs.writeFileSync(path.join(outDir, `${name}.fish`), fishScript(), 'utf-8')

console.log(`✅ Shell completions generated in dist/completions/`)
console.log(`   ${name}.bash  — bash completion`)
console.log(`   ${name}.zsh   — zsh completion`)
console.log(`   ${name}.fish  — fish completion`)
