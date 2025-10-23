const { jsPDF } = window.jspdf;

const ConferenciaApp = {
  timestamps: new Map(),
  ids: new Set(),
  conferidos: new Set(),
  foraDeRota: new Set(),
  duplicados: new Map(),
  routeId: '',
  cluster: '',
  driverName: '',
  viaCsv: false,
  statusById: new Map(),
  destinationFacilityId: '',
  destinationFacilityName: '',
  orhc: '-',
  percentualDS: '0 %',

  registrarDuplicado(codigo) {
    const atual = this.duplicados.get(codigo) || 0;
    this.duplicados.set(codigo, atual + 1);
  },

  tocarAlerta(viaCsv = false) {
    if (!viaCsv && !document.hidden) {
      try {
        const audio = new Audio('mixkit-alarm-tone-996-_1_.mp3');
        audio.play().catch(() => {});
      } catch (e) {}
    }
  },

  alertar(msg) { alert(msg); },

  traduzirStatus(codigo) {
    const mapa = {
      'missrouted': 'Pacote de outra área',
      'bad_address': 'Endereço incorreto ou incompleto',
      'damaged': 'Avariado',
      'buyer_absent': 'Não havia ninguém no endereço',
      'unvisited_address': 'Endereço não visitado',
      'business_closed': 'Negócio fechado',
      'missing': 'Faltante',
      'buyer_moved': 'O comprador mudou de endereço',
      'buyer_rejected': 'Pacote recusado pelo comprador'
    };
    return mapa[codigo] || codigo;
  },

  atualizarProgresso() {
    const total = this.ids.size + this.conferidos.size + this.foraDeRota.size;
    const porcent = total ? Math.floor((this.conferidos.size / total) * 100) : 0;
    $('#progress-bar').css('width', `${porcent}%`).text(`${porcent}%`);
  },

  atualizarListas() {
    $('#conferidos-list').html(
      `<h6>Conferidos (<span class='badge badge-success'>${this.conferidos.size}</span>)</h6>` +
      Array.from(this.conferidos).map(id => `<li class='list-group-item list-group-item-success' id="id-${id}">${id}</li>`).join('')
    );

    $('#faltantes-list').html(
      `<h6>Pendentes (<span class='badge badge-danger'>${this.ids.size}</span>)</h6>` +
      Array.from(this.ids).map(id => `<li class='list-group-item list-group-item-danger' id="id-${id}">${id}</li>`).join('')
    );

    $('#fora-rota-list').html(
      `<h6>Fora de Rota (<span class='badge badge-warning'>${this.foraDeRota.size}</span>)</h6>` +
      Array.from(this.foraDeRota).map(id => `<li class='list-group-item list-group-item-warning'>${id}</li>`).join('')
    );

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

  conferirId(codigo) {
    if (!codigo) return;
    const agora = new Date().toLocaleString();

    if (this.conferidos.has(codigo) || this.foraDeRota.has(codigo)) {
      this.registrarDuplicado(codigo);
      this.timestamps.set(codigo, agora);
      this.tocarAlerta();
      $('#barcode-input').val('').focus();
      this.atualizarListas();
      return;
    }

    if (this.ids.has(codigo)) {
      this.ids.delete(codigo);
      this.conferidos.add(codigo);
      this.timestamps.set(codigo, agora);
    } else {
      this.foraDeRota.add(codigo);
      this.timestamps.set(codigo, agora);
      if (!this.viaCsv) this.tocarAlerta();
    }

    $('#barcode-input').val('').focus();
    this.atualizarListas();
  },

  gerarMensagemResumo({ incluirForaDeRota = true } = {}) {
    const rota = this.routeId || '(sem rota)';
    const xptId = this.destinationFacilityId || $('#destination-facility-title').text().replace('XPT:', '').trim();
    const destino = this.destinationFacilityName || $('#destination-facility-name').text().replace('DESTINO:', '').trim();
    const entregues = this.conferidos.size;
    const pendentes = this.ids.size;
    const naoVisitados = Array.from(this.ids).filter(id => this.statusById.get(id) === 'unvisited_address').length;
    const totalInsucessos = incluirForaDeRota ? (pendentes + this.foraDeRota.size) : pendentes;
    const motorista = this.driverName || '(não informado)';
    const cluster = this.cluster || '(sem cluster)';

    let mensagem = '';
    mensagem += `↩ RTS - Rota: ${rota}\n`;
    mensagem += `🏭 SVC/XPT: ${xptId || '(XPT indefinido)'}${destino ? ' - ' + destino : ''}\n`;
    mensagem += `🎯 Metas: %DS - 99% | ORHC - 85% (não alterar)\n`;
    mensagem += `🕗 ORHC: ${this.orhc}\n`;
    mensagem += `🟢 %DS - Entregues: ${this.percentualDS}\n`;
    mensagem += `🟡 Pendentes/Não Visitados: ${naoVisitados}\n`;
    mensagem += `🔴 Insucessos: ${totalInsucessos}\n\n`;
    mensagem += `♎ Justificativa:\n`;
    mensagem += `Rota ${cluster}\n`;
    mensagem += `Rodacoop | ${motorista}\n`;

    // ==========================
    // RECEBIDOS (insucessos recebidos pela base)
    // ==========================
    mensagem += `\nRecebidos:\n`;
    if (this.conferidos.size > 0) {
      const recebidosOrdenados = Array.from(this.conferidos).sort();
      recebidosOrdenados.forEach(id => {
        const status = this.statusById.get(id);
        const motivo = this.traduzirStatus(status || 'pendente');
        mensagem += `${id}: ${motivo}\n`;
      });
    } else {
      mensagem += `(nenhum recebido)\n`;
    }

    // ==========================
    // NÃO RECEBIDOS (insucessos que não voltaram)
    // ==========================
    mensagem += `\nNão recebidos:\n`;
    if (this.ids.size > 0) {
      const pendentesOrdenados = Array.from(this.ids).sort();
      pendentesOrdenados.forEach(id => {
        const status = this.statusById.get(id);
        if (status !== 'transferred') {
          const motivo = this.traduzirStatus(status || 'pendente');
          mensagem += `${id}: ${motivo}\n`;
        }
      });
    } else {
      mensagem += `(nenhum pendente)\n`;
    }

    // ==========================
    // FORA DE ROTA (opcional)
    // ==========================
    if (incluirForaDeRota && this.foraDeRota.size > 0) {
      mensagem += `\nFora de rota:\n`;
      const foraOrdenados = Array.from(this.foraDeRota).sort();
      foraOrdenados.forEach(id => {
        mensagem += `${id}: fora de rota\n`;
      });
    }

    // Exibir mensagem na caixa de texto editável
    $('#mensagem-final').val(mensagem).removeClass('d-none');
    $('#copy-message').removeClass('d-none');
  }
};

// BOTÃO: VOLTAR
$('#back-btn').click(() => {
  $('#initial-interface').removeClass('d-none');
  $('#conferencia-interface').addClass('d-none');
});

$('#extract-btn').click(() => {
  const raw = $('#html-input').val() || '';

  // ORHC e %DS
  let orhcMatch = /<div class="metric-box__value"><p>(\d{1,2}:\d{2}\s*hs)<\/p><\/div>/i.exec(raw);
  if (!orhcMatch) orhcMatch = /(\d{1,2}:\d{2}\s*hs)/i.exec(raw);
  ConferenciaApp.orhc = orhcMatch ? orhcMatch[1] : '-';

  let dsMatch = /<div class="chart-details-data__value-item">([\d.,]+)\s*<!-- -->\s*%<\/div>/i.exec(raw);
  if (!dsMatch) dsMatch = /([\d.,]+)\s*%/i.exec(raw);
  ConferenciaApp.percentualDS = dsMatch ? `${dsMatch[1]} %` : '0 %';

  let html = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  ConferenciaApp.ids.clear();
  ConferenciaApp.conferidos.clear();
  ConferenciaApp.foraDeRota.clear();
  ConferenciaApp.duplicados.clear();
  ConferenciaApp.timestamps.clear();
  ConferenciaApp.statusById.clear();
  ConferenciaApp.routeId = '';
  ConferenciaApp.cluster = '';
  ConferenciaApp.driverName = '';
  ConferenciaApp.destinationFacilityId = '';
  ConferenciaApp.destinationFacilityName = '';

  const matches = [...html.matchAll(/"id":"(4\d{10})".*?"substatus":"(.*?)"/g)];
  const idsPendentes = [];
  for (const m of matches) {
    const id = m[1];
    const sub = (m[2] || '').trim();
    ConferenciaApp.statusById.set(id, sub);
    if (sub !== 'delivered' && sub !== 'transferred') idsPendentes.push(id);
  }

  if (!idsPendentes.length) {
    ConferenciaApp.alertar('Nenhum ID pendente (substatus diferente de "delivered" ou "transferred") encontrado.');
    return;
  }
  idsPendentes.forEach(id => ConferenciaApp.ids.add(id));

  const routeMatch = /"routeId":\s*(\d+)/.exec(html);
  if (routeMatch) {
    ConferenciaApp.routeId = routeMatch[1];
    $('#route-title').html(`ROTA: <strong>${ConferenciaApp.routeId}</strong><br> RECEBIMENTO DE PACOTES`);
  } else {
    $('#route-title').text('ROTA: (não encontrada)');
  }

  const clusterMatch = /"cluster":"([^"]+)"/.exec(html);
  if (clusterMatch) {
    ConferenciaApp.cluster = clusterMatch[1];
    $('#cluster-title').html(`<span>CLUSTER:</span> <strong>${ConferenciaApp.cluster}</strong>`);
  } else {
    $('#cluster-title').text('');
  }

  const facMatch = /"destinationFacilityId":"([^"]+)","name":"([^"]+)"/.exec(html);
  if (facMatch) {
    const [, destId, facName] = facMatch;
    ConferenciaApp.destinationFacilityId = destId;
    ConferenciaApp.destinationFacilityName = facName;
    $('#destination-facility-title').html(`<strong>XPT:</strong> ${destId}`);
    $('#destination-facility-name').html(`<strong>DESTINO:</strong> ${facName}`);
  } else {
    $('#destination-facility-title').text('');
    $('#destination-facility-name').text('');
  }

  const driverMatch = /"driverName":"([^"]+)"/.exec(html);
  if (driverMatch) {
    ConferenciaApp.driverName = driverMatch[1];
  }

  $('#extracted-total').text(ConferenciaApp.ids.size);
  $('#initial-interface').addClass('d-none');
  $('#conference-interface').removeClass('d-none');
  ConferenciaApp.atualizarListas();
});

$('#barcode-input').on('keypress', (e) => {
  if (e.which === 13) {
    e.preventDefault();
    ConferenciaApp.viaCsv = false;
    const codigo = $('#barcode-input').val().trim();
    ConferenciaApp.conferirId(codigo);
  }
});

$('#generate-message').click(() => ConferenciaApp.gerarMensagemResumo({ incluirForaDeRota: true }));

$('#back-btn').click(() => {
  $('#conference-interface').addClass('d-none');
  $('#initial-interface').removeClass('d-none');
  $('#html-input').val('');
  $('#csv-input').val('');
  $('#barcode-input').val('');
  $('#progress-bar').css('width', '0%').text('0%');

  ConferenciaApp.ids.clear();
  ConferenciaApp.conferidos.clear();
  ConferenciaApp.foraDeRota.clear();
  ConferenciaApp.duplicados.clear();
  ConferenciaApp.timestamps.clear();
  ConferenciaApp.statusById.clear();
  ConferenciaApp.routeId = '';
  ConferenciaApp.cluster = '';
  ConferenciaApp.driverName = '';
  ConferenciaApp.destinationFacilityId = '';
  ConferenciaApp.destinationFacilityName = '';

  ConferenciaApp.atualizarListas();
});
