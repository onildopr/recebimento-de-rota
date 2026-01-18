$(document).ready(() => {
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

    // ========= UPGRADE: normaliza QR/Barcode "sujo" e extrai ID =========
    normalizarCodigo(raw) {
      if (!raw) return null;

      // trim + remove caracteres de controle/invisíveis
      let s = String(raw)
        .trim()
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

      // Seu padrão principal: 11 dígitos começando com 4
      let m = s.match(/(4\d{10})/);
      if (m) return m[1];

      // Fallback: remove tudo que não for número e pega 11 primeiros
      m = s.replace(/\D/g, '').match(/(\d{11,})/);
      if (m) return m[1].slice(0, 11);

      return null;
    },
    // ================================================================

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
        'buyer_rejected': 'Pacote recusado pelo comprador',
        'inaccessible_address' : 'Endereço inacessível',
        'blocked_by_keyword':'Palavra-chave incorreta',
        'picked_up':'Coletado',
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
        Array.from(this.conferidos).map(id => {
          const info = this.timestamps.get(id) || '';
          const manual = info.includes('(MANUAL)');
          return `
            <li class='list-group-item ${manual ? 'list-group-item-info' : 'list-group-item-success'}' id="id-${id}">
              ${id}
              ${manual ? "<span class='badge badge-secondary ml-2'>MANUAL</span>" : ""}
            </li>`;
        }).join('')
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

    // ========= UPGRADE: agora recebe origem ('scanner'|'manual') =========
    conferirId(codigo, origem = 'scanner') {
      if (!codigo) return;

      const agora = new Date().toLocaleString();
      const infoHora = origem === 'manual' ? `${agora} (MANUAL)` : `${agora} (LEITOR)`;

      if (this.conferidos.has(codigo) || this.foraDeRota.has(codigo)) {
        this.registrarDuplicado(codigo);
        this.timestamps.set(codigo, infoHora);
        this.tocarAlerta();
        $('#barcode-input').val('').focus();
        this.atualizarListas();
        return;
      }

      if (this.ids.has(codigo)) {
        this.ids.delete(codigo);
        this.conferidos.add(codigo);
        this.timestamps.set(codigo, infoHora);
      } else {
        this.foraDeRota.add(codigo);
        this.timestamps.set(codigo, infoHora);
        if (!this.viaCsv) this.tocarAlerta();
      }

      $('#barcode-input').val('').focus();
      this.atualizarListas();
    },
    // ===================================================================

    gerarMensagemResumo({ incluirForaDeRota = true } = {}) {
      const rota = this.routeId || '(sem rota)';
      const xptId = this.destinationFacilityId || $('#destination-facility-title').text().replace('XPT:', '').trim();
      const destino = this.destinationFacilityName || $('#destination-facility-name').text().replace('DESTINO:', '').trim();
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

      if (incluirForaDeRota && this.foraDeRota.size > 0) {
        mensagem += `\nFora de rota:\n`;
        const foraOrdenados = Array.from(this.foraDeRota).sort();
        foraOrdenados.forEach(id => {
          mensagem += `${id}: fora de rota\n`;
        });
      }

      $('#mensagem-final').val(mensagem).removeClass('d-none');
      $('#copy-message').removeClass('d-none');
    }
  };

  // =============================
  // BOTÕES E EVENTOS
  // =============================

  $('#check-csv').click(() => {
    const file = $('#csv-input')[0].files[0];
    if (!file) {
      ConferenciaApp.alertar('Selecione um arquivo CSV primeiro.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const csvData = e.target.result.split(/\r?\n/).map(l => l.trim()).filter(l => l);
      let totalLidas = 0;

      ConferenciaApp.viaCsv = true;
      csvData.forEach(line => {
        const id = ConferenciaApp.normalizarCodigo(line);
        if (id) {
          totalLidas++;
          ConferenciaApp.conferirId(id, 'scanner');
        }
      });

      ConferenciaApp.viaCsv = false;
      ConferenciaApp.alertar(`Conferência via CSV concluída. ${totalLidas} linhas processadas.`);
    };
    reader.readAsText(file, 'utf-8');
  });

  // ✅ EXPORTAR XLSX (mantido e funcionando)
  $('#export-xlsx').click(() => {
    if (typeof XLSX === 'undefined') {
      ConferenciaApp.alertar('Biblioteca XLSX não carregada. Verifique a conexão ou ordem dos scripts.');
      return;
    }

    const ws_data = [['ID', 'Status', 'Situação', 'Horário conferência']];

    ConferenciaApp.conferidos.forEach(id => {
      ws_data.push([
        id,
        ConferenciaApp.traduzirStatus(ConferenciaApp.statusById.get(id) || 'pendente'),
        'Recebido',
        ConferenciaApp.timestamps.get(id) || ''
      ]);
    });

    ConferenciaApp.ids.forEach(id => {
      ws_data.push([
        id,
        ConferenciaApp.traduzirStatus(ConferenciaApp.statusById.get(id) || 'pendente'),
        'Pendente',
        ''
      ]);
    });

    ConferenciaApp.foraDeRota.forEach(id => {
      ws_data.push([
        id,
        'Fora de rota',
        'Fora de rota',
        ConferenciaApp.timestamps.get(id) || ''
      ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    XLSX.utils.book_append_sheet(wb, ws, 'Conferencia');

    const nomeArquivo = `Conferencia_Rota_${ConferenciaApp.routeId || 'sem_rota'}.xlsx`;
    XLSX.writeFile(wb, nomeArquivo);
  });

  $('#extract-btn').click(() => {
    const raw = $('#html-input').val() || '';

    let orhcMatch = /<div class="metric-box__value"><p>(\d{1,2}:\d{2}\s*h)<\/p><\/div>/i.exec(raw);
    if (!orhcMatch) orhcMatch = /(\d{1,2}:\d{2}\s*h)/i.exec(raw);
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

    // ========= TRECHO AJUSTADO PARA PEGAR substatus null =========
    const matches = [...html.matchAll(
      /"id":(4\d{10}).*?"substatus":\s*(null|"([^"]*)")/g
    )];

    const idsPendentes = [];
    for (const m of matches) {
      const id = m[1];
      const sub = (m[2] === 'null' || m[2] == null) ? null : (m[3] || '').trim();

      ConferenciaApp.statusById.set(id, sub);

      if (sub !== 'delivered' && sub !== 'transferred') {
        idsPendentes.push(id);
      }
    }
    // ========= FIM DO AJUSTE =========

    if (!idsPendentes.length) {
      ConferenciaApp.alertar('Nenhum ID pendente encontrado.');
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
    }

    const facMatch = /"destinationFacilityId":"([^"]+)","name":"([^"]+)"/.exec(html);
    if (facMatch) {
      const [, destId, facName] = facMatch;
      ConferenciaApp.destinationFacilityId = destId;
      ConferenciaApp.destinationFacilityName = facName;
      $('#destination-facility-title').html(`<strong>XPT:</strong> ${destId}`);
      $('#destination-facility-name').html(`<strong>DESTINO:</strong> ${facName}`);
    }

    const driverMatch = /"driverName":"([^"]+)"/.exec(html);
    if (driverMatch) ConferenciaApp.driverName = driverMatch[1];

    $('#extracted-total').text(ConferenciaApp.ids.size);
    $('#initial-interface').addClass('d-none');
    $('#conference-interface').removeClass('d-none');
    ConferenciaApp.atualizarListas();
  });

  // ========= UPGRADE: detectar MANUAL vs LEITOR e atualizar #input-origin =========
  let scanBuffer = '';
  let lastKeyTime = 0;
  let origemEntrada = 'manual'; // 'scanner' | 'manual'
  const SCAN_THRESHOLD = 60; // ms

  function atualizarOrigemUI(origem) {
    const el = document.getElementById('input-origin');
    if (!el) return;
    el.textContent = (origem === 'scanner') ? 'LEITOR' : 'MANUAL';
  }

  $('#barcode-input').on('keydown', (e) => {
    const now = Date.now();
    const diff = now - lastKeyTime;
    lastKeyTime = now;

    if (diff < SCAN_THRESHOLD) {
      origemEntrada = 'scanner';
    } else {
      origemEntrada = 'manual';
      scanBuffer = '';
    }

    atualizarOrigemUI(origemEntrada);

    if (e.key === 'Enter') {
      e.preventDefault();
      ConferenciaApp.viaCsv = false;

      const raw = (origemEntrada === 'scanner') ? scanBuffer : $('#barcode-input').val();
      const id = ConferenciaApp.normalizarCodigo(raw);

      if (id) {
        ConferenciaApp.conferirId(id, origemEntrada);
      }

      scanBuffer = '';
      origemEntrada = 'manual';
      atualizarOrigemUI(origemEntrada);
      $('#barcode-input').val('').focus();
      return;
    }

    if (e.key && e.key.length === 1) {
      scanBuffer += e.key;
    }
  });
  // ============================================================================

  $('#generate-message').click(() => ConferenciaApp.gerarMensagemResumo({ incluirForaDeRota: true }));

  $('#copy-message').click(() => {
    const txt = $('#mensagem-final').val();
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(() => {
      // opcional: feedback rápido
      // ConferenciaApp.alertar('Mensagem copiada!');
    }).catch(() => {
      // fallback antigo
      $('#mensagem-final')[0].select();
      document.execCommand('copy');
    });
  });

  $('#back-btn').click(() => {
    $('#conference-interface').addClass('d-none');
    $('#initial-interface').removeClass('d-none');
    $('#html-input, #csv-input, #barcode-input').val('');
    $('#progress-bar').css('width', '0%').text('0%');

    ConferenciaApp.ids.clear();
    ConferenciaApp.conferidos.clear();
    ConferenciaApp.foraDeRota.clear();
    ConferenciaApp.duplicados.clear();
    ConferenciaApp.timestamps.clear();
    ConferenciaApp.statusById.clear();

    // reset do indicador
    atualizarOrigemUI('manual');

    ConferenciaApp.atualizarListas();
  });
});
