export function bashScript(name: string): string {
  return `# ${name} bash completion
_${name}() {
  local IFS=\\$'\\n'
  COMPREPLY=($(${name} _complete "\${COMP_WORDS[@]}" 2>/dev/null))
}
complete -F _${name} ${name}
`
}

export function zshScript(name: string): string {
  return `# ${name} zsh completion
#compdef ${name}

_${name}() {
  local -a completions
  completions=("\${(@f)$(${name} _complete "\${words[@]}" 2>/dev/null)}")
  _describe '${name}' completions
}
compdef _${name} ${name}
`
}

export function fishScript(name: string): string {
  return `# ${name} fish completion
complete -c ${name} -f -a '(${name} _complete (commandline -cp) 2>/dev/null)'
`
}

export function generateCompletionScript(name: string, shell: string): string {
  switch (shell) {
    case 'bash':
      return bashScript(name)
    case 'zsh':
      return zshScript(name)
    case 'fish':
      return fishScript(name)
    default:
      throw new Error(`Unsupported shell: ${shell}. Use bash, zsh, or fish.`)
  }
}
