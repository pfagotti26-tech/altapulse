// Execução direta dos módulos-fonte do piloto. No instalador, build.mjs copia
// a implementação compartilhada para staging/policy.cjs, sem referência externa.
module.exports = require('../policy.cjs');