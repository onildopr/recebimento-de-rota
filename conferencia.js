const { jsPDF } = window.jspdf;

const ConferenciaApp = {
  // Estados
  timestamps: new Map(),       // ID -> data/hora
  ids: new Set(),              // PENDENTES (substatus != delivered)
  conferidos: new Set(),       // RECEBIDOS
  foraDeRota: new Set(),       // IDs lidos que não pertencem aos pendentes
  duplicados: new Map(),       // ID -> contagem de repetições (além da 1ª)
  routeId: '',
  cluster: '',
  driverName: '',
  viaCsv: false,

  // ---- Utilidades ----
  registrarDuplicado(codigo) {
    const atual = this.duplicados.get(codigo) || 0;
    this.duplicados.set(codigo, atual + 1);
  },

  tocarAlerta(viaCsv = false) {
    if (!viaCsv) {
      try {
        const audio = new Audio('mixkit-alarm-tone-996-_1_.mp3');
        audio.play();
      } catch(e) { /* silencia autoplay */ }
    }
  },

  alertar(msg) {
    alert(msg);
  },

  // ---- UI ----
  atualizarProgresso() {
    const total = this.ids.size + this.conferidos.size;
    const porcent = total ? Math.floor((this.conferidos.size / total) * 100) : 0;
    $('#progress-bar').css('width', `${porcent}%`).text(`${porcent}%`);
  },

  atualizarListas() {
    // Conferidos
    $('#conferidos-list').html(
      `<h6>Conferidos (<span class='badge badge-success'>${this.conferidos.size}</span>)</h6>` +
      Array.from(this.conferidos).map(id => `<li class='list-group-item list-group-item-success' id="id-${id}">${id}</li>`).join('')
    );

    // Pendentes
    $('#faltantes-list').html(
      `<h6>Pendentes (<span class='badge badge-danger'>${this.ids.size}</span>)</h6>` +
      Array.from(this.ids).map(id => `<li class='list-group-item list-group-item-danger' id="id-${id}">${id}</li>`).join('')
    );

    // Fora de rota
    $('#fora-rota-list').html(
      `<h6>Fora de Rota (<span class='badge badge-warning'>${this.foraDeRota.size}</span>)</h6>` +
      Array.from(this.foraDeRota).map(id => `<li class='list-group-item list-group-item-warning'>${id}</li>`).join('')
    );

    // Duplicados
    const dupHTML = Array.from(this.duplicados.entries()).map(([id, rep]) => {
      const suf = rep > 1 ? ` x${rep}` : '';
      return `<li class='list-group-item list-group-item-warning'>${id}${suf}</li>`;
    }).join('');
    $('#duplicados-list').html(
      `<h6>Duplicados (<span class='badge badge-warning'>${this.duplicados.size}</span>)</h6>` + dupHTML
    );

    $('#verified-total').text(this.conferidos.size);
    this.atualizarProgresso();
  },

  // ---- Núcleo ----
  conferirId(codigo) {
    if (!codigo) return;
    const agora = new Date().toLocaleString();

    // Já contabilizado como conferido ou fora de rota → duplicado
    if (this.conferidos.has(codigo) || this.foraDeRota.has(codigo)) {
      this.registrarDuplicado(codigo);
      this.timestamps.set(codigo, agora);
      this.tocarAlerta();
      $('#barcode-input').val('').focus();
      this.atualizarListas();
      return;
    }

    // É um pendente conhecido?
    if (this.ids.has(codigo)) {
      this.ids.delete(codigo);
      this.conferidos.add(codigo);
      this.timestamps.set(codigo, agora);
    } else {
      // Não estava na lista de pendentes → fora de rota
      this.foraDeRota.add(codigo);
      this.timestamps.set(codigo, agora);
      if (!this.viaCsv) this.tocarAlerta();
    }

    $('#barcode-input').val('').focus();
    this.atualizarListas();
  },

  // ---- Exportações ----
  gerarCsvExcelFriendly() {
    // Linhas de cabeçalho
    const headerLines = [
      [`Motorista:`, this.driverName || ''],
      [`Rota:`, this.routeId || ''],
      this.cluster ? [`Cluster:`, this.cluster] : [],
    ].filter(l => l.length);

    // Colunas paralelas: Pendentes | Recebidos | Fora de Rota | Duplicados
    const pendentes = Array.from(this.ids);
    const recebidos = Array.from(this.conferidos);
    const fora = Array.from(this.foraDeRota);
    const dups = Array.from(this.duplicados.keys());

    const maxLen = Math.max(pendentes.length, recebidos.length, fora.length, dups.length);
    const linhas = [];
    linhas.push(['Pendentes', 'Recebidos', 'Fora de Rota', 'Duplicados']);
    for (let i = 0; i < maxLen; i++) {
      linhas.push([
        pendentes[i] || '',
        recebidos[i] || '',
        fora[i] || '',
        dups[i] || ''
      ]);
    }

    // Montagem CSV (CRLF)
    const headerCSV = headerLines.map(r => r.join(',')).join('\r\n');
    const corpoCSV = linhas.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const conteudo = headerCSV + (headerCSV ? '\r\n\r\n' : '') + corpoCSV;

    const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const base = `conferencia_${this.routeId || 'semRota'}`;
    link.download = `${base}.csv`;
    link.click();
  },

  gerarRelatorioTxt() {
    let conteudo = '';
    if (this.driverName || this.routeId) {
      conteudo += `Motorista: ${this.driverName || ''}\n`;
      conteudo += `Rota: ${this.routeId || ''}\n`;
      if (this.cluster) conteudo += `Cluster: ${this.cluster}\n`;
      conteudo += '\n';
    }
    if (this.conferidos.size) {
      conteudo += 'CONFERIDOS:\n' + Array.from(this.conferidos).join('\n') + '\n\n';
    }
    if (this.ids.size) {
      conteudo += 'PENDENTES:\n' + Array.from(this.ids).join('\n') + '\n\n';
    }
    if (this.foraDeRota.size) {
      conteudo += 'FORA DE ROTA:\n' + Array.from(this.foraDeRota).join('\n') + '\n';
    }
    const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'relatorio.txt';
    link.click();
  },

  gerarRelatorioCsv() {
    let conteudo = 'Categoria,ID\n';
    this.conferidos.forEach(id => (conteudo += `Conferido,${id}\n`));
    this.ids.forEach(id => (conteudo += `Pendente,${id}\n`));
    this.foraDeRota.forEach(id => (conteudo += `Fora de Rota,${id}\n`));
    const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'relatorio_listas.csv';
    link.click();
  },

  gerarRelatorioPdf() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    let y = 10;
    const margemInferior = 280;

    doc.setFontSize(16);
    doc.text('Relatório de Conferência de Rota', 10, y); y += 8;
    doc.setFontSize(10);

    if (this.driverName) { doc.text(`Motorista: ${this.driverName}`, 10, y); y += 5; }
    if (this.routeId)    { doc.text(`Rota: ${this.routeId}`, 10, y); y += 5; }
    if (this.cluster)    { doc.text(`Cluster: ${this.cluster}`, 10, y); y += 7; }

    const bloco = (titulo, cor, dados) => {
      if (!dados.size) return;
      doc.setTextColor(...cor);
      doc.text(titulo, 10, y); y += 6;
      dados.forEach(id => {
        if (y > margemInferior) {
          doc.addPage('a4', 'portrait'); y = 10; doc.setFontSize(10);
          doc.setTextColor(...cor); doc.text(`${titulo} (cont.)`, 10, y); y += 6;
        }
        doc.text(id, 10, y); y += 5;
      });
      y += 4;
    };

    bloco('Conferidos:', [0,128,0], this.conferidos);
    bloco('Pendentes:',  [255,0,0], this.ids);
    bloco('Fora de Rota:', [255,165,0], this.foraDeRota);

    doc.save('relatorio.pdf');
  },

  finalizar() {
    // Gera CSV em formato amigável para Excel, com cabeçalho Motorista/Rota/Cluster e colunas paralelas
    this.gerarCsvExcelFriendly();
    $('#reportModal').modal('show');
  }
};
// === XLSX: gerar arquivo Excel com colunas separadas ===
ConferenciaApp.gerarExcelXlsx = function () {
  if (typeof XLSX === 'undefined') {
    this.alertar('Biblioteca XLSX não encontrada. Verifique se o script foi incluído no HTML.');
    return;
  }

  // Cabeçalho (linhas superiores com metadados)
  const headerLines = [
    ['Motorista:', this.driverName || ''],
    ['Rota:', this.routeId || ''],
  ];
  if (this.cluster) headerLines.push(['Cluster:', this.cluster]);

  // Título da tabela
  const titleRow = [['Pendentes', 'Recebidos', 'Fora de Rota', 'Duplicados']];

  // Quatro colunas lado a lado
  const pendentes = Array.from(this.ids);
  const recebidos = Array.from(this.conferidos);
  const fora = Array.from(this.foraDeRota);
  const dups = Array.from(this.duplicados.keys());
  const maxLen = Math.max(pendentes.length, recebidos.length, fora.length, dups.length);

  const tableRows = [];
  for (let i = 0; i < maxLen; i++) {
    tableRows.push([
      pendentes[i] || '',
      recebidos[i] || '',
      fora[i] || '',
      dups[i] || ''
    ]);
  }

  // Monta a planilha (AOA = Array of Arrays)
  const aoa = [
    ...headerLines,
    [],                // linha em branco
    ...titleRow,
    ...tableRows
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Larguras de coluna (opcional)
  ws['!cols'] = [
    { wch: 18 }, // Pendentes
    { wch: 18 }, // Recebidos
    { wch: 18 }, // Fora de Rota
    { wch: 18 }, // Duplicados
  ];

  // Cria o workbook e salva
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Conferência');

  const base = `conferencia_${this.routeId || 'semRota'}`;
  XLSX.writeFile(wb, `${base}.xlsx`);
};

// Vincula o botão do modal
$('#export-xlsx').click(() => ConferenciaApp.gerarExcelXlsx());

// ---- Handlers ----

// 1) Botão EXTRair: pega IDs pendentes (substatus != delivered) + routeId + cluster + driverName
$('#extract-btn').click(() => {
  let html = $('#html-input').val() || '';
  // Remove tags HTML e comprime espaços para facilitar regex
  html = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Reseta estado
  ConferenciaApp.ids.clear();
  ConferenciaApp.conferidos.clear();
  ConferenciaApp.foraDeRota.clear();
  ConferenciaApp.duplicados.clear();
  ConferenciaApp.timestamps.clear();
  ConferenciaApp.routeId = '';
  ConferenciaApp.cluster = '';
  ConferenciaApp.driverName = '';

  // Extrai IDs com substatus
  const matches = [...html.matchAll(/"id":"(4\d{10})".*?"substatus":"(.*?)"/g)];
  const idsPendentes = matches.filter(m => m[2] !== 'delivered').map(m => m[1]);

  if (!idsPendentes.length) {
    ConferenciaApp.alertar('Nenhum ID pendente (substatus diferente de "delivered") encontrado.');
    return;
  }
  idsPendentes.forEach(id => ConferenciaApp.ids.add(id));

  // routeId (opcional)
  const routeMatch = /"routeId":\s*(\d+)/.exec(html);
  if (routeMatch) {
    ConferenciaApp.routeId = routeMatch[1];
    $('#route-title').html(`ROTA: <strong>${ConferenciaApp.routeId}</strong><br> RECEBIMENTO DE PACOTES`);
  } else {
    $('#route-title').text('ROTA: (não encontrada)');
  }

  // cluster (opcional, com guarda para não quebrar)
  const clusterMatch = /"cluster":"([^"]+)"/.exec(html);
  if (clusterMatch) {
    ConferenciaApp.cluster = clusterMatch[1];
    $('#cluster-title').html(`<span>CLUSTER:</span> <strong>${ConferenciaApp.cluster}</strong>`);
  } else {
    $('#cluster-title').text('');
  }

  // destination / facility (opcional)
  const facMatch = /"destinationFacilityId":"([^"]+)","name":"([^"]+)"/.exec(html);
  if (facMatch) {
    const [, destId, facName] = facMatch;
    $('#destination-facility-title').html(`<strong>XPT:</strong> ${destId}`);
    $('#destination-facility-name').html(`<strong>DESTINO:</strong> ${facName}`);
  } else {
    $('#destination-facility-title').text('');
    $('#destination-facility-name').text('');
  }

  // driverName (opcional)
  const driverMatch = /"driverName":"([^"]+)"/.exec(html);
  if (driverMatch) {
    ConferenciaApp.driverName = driverMatch[1];
  }

  // Atualiza contadores e UI
  $('#extracted-total').text(ConferenciaApp.ids.size);
  $('#initial-interface').addClass('d-none');
  $('#conference-interface').removeClass('d-none');
  ConferenciaApp.atualizarListas();
});

// 2) Entrada manual via leitor/teclado (Enter)
$('#barcode-input').on('keypress', (e) => {
  if (e.which === 13) {
    e.preventDefault();
    ConferenciaApp.viaCsv = false;
    const codigo = $('#barcode-input').val().trim();
    ConferenciaApp.conferirId(codigo);
  }
});

// 3) Processamento de CSV externo (coluna que contenha os códigos)
$('#check-csv').click(() => {
  const fileInput = document.getElementById('csv-input');
  if (!fileInput.files.length) {
    ConferenciaApp.alertar('Selecione um arquivo CSV.');
    return;
  }

  ConferenciaApp.viaCsv = true;
  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = function(e) {
    const csvText = e.target.result || '';
    const linhas = csvText.split(/\r?\n/).filter(l => l.trim().length);
    if (!linhas.length) {
      ConferenciaApp.alertar('Arquivo CSV vazio.');
      ConferenciaApp.viaCsv = false;
      return;
    }

    // Tenta achar uma coluna "text"; se não existir, usa todas as colunas procurando um 4...........
    const header = linhas[0].split(',');
    let textCol = header.findIndex(h => h.toLowerCase().includes('text'));
    if (textCol === -1) textCol = null;

    for (let i = 1; i < linhas.length; i++) {
      const cols = linhas[i].split(',');
      const campos = textCol !== null ? [cols[textCol]] : cols;
      for (const campoBruto of campos) {
        if (!campoBruto) continue;
        const campo = campoBruto.trim().replace(/^"|"$/g, '').replace(/""/g, '"');
        const m = campo.match(/(4\d{10})/);
        if (m) {
          ConferenciaApp.conferirId(m[1]);
          break;
        }
      }
    }
    ConferenciaApp.atualizarListas();
    ConferenciaApp.viaCsv = false;
  };
  reader.readAsText(file, 'UTF-8');
});

// 4) Botões finais
$('#finish-btn').click(() => ConferenciaApp.finalizar());
$('#back-btn').click(() => location.reload());
$('#export-txt').click(() => ConferenciaApp.gerarRelatorioTxt());
$('#export-csv').click(() => ConferenciaApp.gerarRelatorioCsv());
$('#export-pdf').click(() => ConferenciaApp.gerarRelatorioPdf());