$(document).ready(() => {
  const { jsPDF } = window.jspdf || {};

  const STORAGE_KEY = 'conferencia.insucessos.routes.v1';

  const ConferenciaApp = {
    // multi-rotas
    routes: new Map(),     // routeId -> routeObj
    currentRouteId: null,

    // estado de leitura (scanner/manual/csv)
    viaCsv: false,

    // ========= normaliza QR/Barcode "sujo" =========
    normalizarCodigo(raw) {
      if (!raw) return null;

      let s = String(raw).trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
      let m = s.match(/(4\d{10})/);
      if (m) return m[1];

      m = s.replace(/\D/g, '').match(/(\d{11,})/);
      if (m) return m[1].slice(0, 11);

      return null;
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

    tocarAlerta(viaCsv = false) {
      if (!viaCsv && !document.hidden) {
        try {
          const audio = new Audio('mixkit-alarm-tone-996-_1_.mp3');
          audio.play().catch(() => {});
        } catch (e) {}
      }
    },

    // ==========================
    // Modelo de rota (somente insucessos/pendentes como você quer)
    // ==========================
    makeEmptyRoute(routeId) {
      return {
        routeId: String(routeId),
        cluster: '',
        driverName: '',
        destinationFacilityId: '',
        destinationFacilityName: '',
        orhc: '-',
        percentualDS: '0 %',

        // ids = INSUCCESSOS/PENDENTES (extraídos do HTML)
        ids: new Set(),
        conferidos: new Set(),
        foraDeRota: new Set(),
        duplicados: new Map(),
        timestamps: new Map(),
        statusById: new Map(),
      };
    },

    get current() {
      if (!this.currentRouteId) return null;
      return this.routes.get(String(this.currentRouteId)) || null;
    },

    // ==========================
    // Persistência
    // ==========================
    saveToStorage() {
      try {
        const obj = {};
        for (const [rid, r] of this.routes.entries()) {
          obj[rid] = {
            routeId: r.routeId,
            cluster: r.cluster,
            driverName: r.driverName,
            destinationFacilityId: r.destinationFacilityId,
            destinationFacilityName: r.destinationFacilityName,
            orhc: r.orhc,
            percentualDS: r.percentualDS,

            ids: Array.from(r.ids),
            conferidos: Array.from(r.conferidos),
            foraDeRota: Array.from(r.foraDeRota),
            duplicados: Object.fromEntries(r.duplicados),
            timestamps: Object.fromEntries(r.timestamps),
            statusById: Object.fromEntries(r.statusById),
          };
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      } catch (e) {
        console.warn('save storage fail', e);
      }
    },

    loadFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        this.routes.clear();

        for (const [rid, data] of Object.entries(parsed || {})) {
          const r = this.makeEmptyRoute(rid);

          r.cluster = data.cluster || '';
          r.driverName = data.driverName || '';
          r.destinationFacilityId = data.destinationFacilityId || '';
          r.destinationFacilityName = data.destinationFacilityName || '';
          r.orhc = data.orhc || '-';
          r.percentualDS = data.percentualDS || '0 %';

          (data.ids || []).forEach(x => r.ids.add(x));
          (data.conferidos || []).forEach(x => r.conferidos.add(x));
          (data.foraDeRota || []).forEach(x => r.foraDeRota.add(x));

          r.duplicados = new Map(Object.entries(data.duplicados || {}).map(([k, v]) => [k, Number(v || 0)]));
          r.timestamps = new Map(Object.entries(data.timestamps || {}));
          r.statusById = new Map(Object.entries(data.statusById || {}));

          this.routes.set(String(rid), r);
        }
      } catch (e) {
        console.warn('load storage fail', e);
      }
    },

    deleteRoute(routeId) {
      if (!routeId) return;
      this.routes.delete(String(routeId));
      if (this.currentRouteId === String(routeId)) this.currentRouteId = null;
      this.saveToStorage();
      this.renderRoutesSelects();
    },

    clearAllRoutes() {
      this.routes.clear();
      this.currentRouteId = null;
      localStorage.removeItem(STORAGE_KEY);
      this.renderRoutesSelects();
    },

    // ==========================
    // UI selects
    // ==========================
    renderRoutesSelects() {
      const routesSorted = Array.from(this.routes.values())
        .sort((a, b) => String(a.routeId).localeCompare(String(b.routeId)));

      const makeLabel = (r) => {
        const extras = [];
        if (r.cluster) extras.push(`CLUSTER ${r.cluster}`);
        if (r.destinationFacilityId) extras.push(`XPT ${r.destinationFacilityId}`);
        return `ROTA ${r.routeId}${extras.length ? ' • ' + extras.join(' • ') : ''}`;
      };

      $('#saved-routes').html(
        ['<option value="">(Nenhuma selecionada)</option>']
          .concat(routesSorted.map(r => `<option value="${r.routeId}">${makeLabel(r)}</option>`))
          .join('')
      );

      $('#saved-routes-inapp').html(routesSorted.map(r => `<option value="${r.routeId}">${makeLabel(r)}</option>`).join(''));

      // fechamento diário
      const $fdSel = $('#fd-rotas');
      if ($fdSel.length) {
        $fdSel.html(routesSorted.map(r => `<option value="${r.routeId}">ROTA ${r.routeId}${r.driverName ? ` — ${r.driverName}` : ''}</option>`).join(''));
      }

      if (this.currentRouteId) {
        $('#saved-routes').val(this.currentRouteId);
        $('#saved-routes-inapp').val(this.currentRouteId);
      }
    },

    setCurrentRoute(routeId) {
      const rid = String(routeId);
      if (!this.routes.has(rid)) return this.alertar('Rota não encontrada.');
      this.currentRouteId = rid;
      this.renderRoutesSelects();
      this.refreshUIFromCurrent();
      this.saveToStorage();
    },

    refreshUIFromCurrent() {
      const r = this.current;
      if (!r) return;

      $('#route-title').html(`ROTA: <strong>${r.routeId}</strong><br> RECEBIMENTO DE PACOTES`);

      if (r.cluster) $('#cluster-title').html(`<span>CLUSTER:</span> <strong>${r.cluster}</strong>`);
      else $('#cluster-title').html('');

      if (r.destinationFacilityId) $('#destination-facility-title').html(`<strong>XPT:</strong> ${r.destinationFacilityId}`);
      else $('#destination-facility-title').html('');

      if (r.destinationFacilityName) $('#destination-facility-name').html(`<strong>DESTINO:</strong> ${r.destinationFacilityName}`);
      else $('#destination-facility-name').html('');

      $('#extracted-total').text(r.ids.size);
      $('#verified-total').text(r.conferidos.size);

      this.atualizarListas();
    },

    // ==========================
    // Lógica de conferência (igual a tua, só que por rota)
    // ==========================
    registrarDuplicado(r, codigo) {
      const atual = r.duplicados.get(codigo) || 0;
      r.duplicados.set(codigo, atual + 1);
    },

    atualizarProgresso() {
      const r = this.current;
      if (!r) return;

      const total = r.ids.size + r.conferidos.size + r.foraDeRota.size;
      const porcent = total ? Math.floor((r.conferidos.size / total) * 100) : 0;
      $('#progress-bar').css('width', `${porcent}%`).text(`${porcent}%`);
    },

    atualizarListas() {
      const r = this.current;
      if (!r) return;

      $('#conferidos-list').html(
        `<h6>Conferidos (<span class='badge badge-success'>${r.conferidos.size}</span>)</h6>` +
        Array.from(r.conferidos).map(id => {
          const info = r.timestamps.get(id) || '';
          const manual = info.includes('(MANUAL)');
          return `
            <li class='list-group-item ${manual ? 'list-group-item-info' : 'list-group-item-success'}' id="id-${id}">
              ${id}
              ${manual ? "<span class='badge badge-secondary ml-2'>MANUAL</span>" : ""}
            </li>`;
        }).join('')
      );

      $('#faltantes-list').html(
        `<h6>Pendentes (<span class='badge badge-danger'>${r.ids.size}</span>)</h6>` +
        Array.from(r.ids).map(id => `<li class='list-group-item list-group-item-danger' id="id-${id}">${id}</li>`).join('')
      );

      $('#fora-rota-list').html(
        `<h6>Fora de Rota (<span class='badge badge-warning'>${r.foraDeRota.size}</span>)</h6>` +
        Array.from(r.foraDeRota).map(id => `<li class='list-group-item list-group-item-warning'>${id}</li>`).join('')
      );

      const dupHTML = Array.from(r.duplicados.entries()).map(([id, rep]) => {
        const suf = rep > 1 ? ` x${rep}` : '';
        return `<li class='list-group-item list-group-item-warning'>${id}${suf}</li>`;
      }).join('');
      $('#duplicados-list').html(
        `<h6>Duplicados (<span class='badge badge-warning'>${r.duplicados.size}</span>)</h6>` + dupHTML
      );

      $('#verified-total').text(r.conferidos.size);
      this.atualizarProgresso();
      this.saveToStorage();
    },

    conferirId(codigo, origem = 'scanner') {
      const r = this.current;
      if (!r || !codigo) return;

      const agora = new Date().toLocaleString();
      const infoHora = origem === 'manual' ? `${agora} (MANUAL)` : `${agora} (LEITOR)`;

      if (r.conferidos.has(codigo) || r.foraDeRota.has(codigo)) {
        this.registrarDuplicado(r, codigo);
        r.timestamps.set(codigo, infoHora);
        this.tocarAlerta();
        $('#barcode-input').val('').focus();
        this.atualizarListas();
        return;
      }

      if (r.ids.has(codigo)) {
        r.ids.delete(codigo);
        r.conferidos.add(codigo);
        r.timestamps.set(codigo, infoHora);
      } else {
        r.foraDeRota.add(codigo);
        r.timestamps.set(codigo, infoHora);
        if (!this.viaCsv) this.tocarAlerta();
      }

      $('#barcode-input').val('').focus();
      this.atualizarListas();
    },

    gerarMensagemResumo({ incluirForaDeRota = true } = {}) {
      const r = this.current;
      if (!r) return;

      const rota = r.routeId || '(sem rota)';
      const xptId = r.destinationFacilityId || $('#destination-facility-title').text().replace('XPT:', '').trim();
      const destino = r.destinationFacilityName || $('#destination-facility-name').text().replace('DESTINO:', '').trim();
      const pendentes = r.ids.size;
      const naoVisitados = Array.from(r.ids).filter(id => r.statusById.get(id) === 'unvisited_address').length;
      const totalInsucessos = incluirForaDeRota ? (pendentes + r.foraDeRota.size) : pendentes;
      const motorista = r.driverName || '(não informado)';
      const cluster = r.cluster || '(sem cluster)';

      let mensagem = '';
      mensagem += `↩ RTS - Rota: ${rota}\n`;
      mensagem += `🏭 SVC/XPT: ${xptId || '(XPT indefinido)'}${destino ? ' - ' + destino : ''}\n`;
      mensagem += `🎯 Metas: %DS - 99% | ORHC - 85% (não alterar)\n`;
      mensagem += `🕗 ORHC: ${r.orhc}\n`;
      mensagem += `🟢 %DS - Entregues: ${r.percentualDS}\n`;
      mensagem += `🟡 Pendentes/Não Visitados: ${naoVisitados}\n`;
      mensagem += `🔴 Insucessos: ${totalInsucessos}\n\n`;
      mensagem += `♎ Justificativa:\n`;
      mensagem += `Rota ${cluster}\n`;
      mensagem += `Rodacoop | ${motorista}\n`;

      mensagem += `\nRecebidos:\n`;
      if (r.conferidos.size > 0) {
        const recebidosOrdenados = Array.from(r.conferidos).sort();
        recebidosOrdenados.forEach(id => {
          const status = r.statusById.get(id);
          const motivo = this.traduzirStatus(status || 'pendente');
          mensagem += `${id}: ${motivo}\n`;
        });
      } else {
        mensagem += `(nenhum recebido)\n`;
      }

      mensagem += `\nNão recebidos:\n`;
      if (r.ids.size > 0) {
        const pendentesOrdenados = Array.from(r.ids).sort();
        pendentesOrdenados.forEach(id => {
          const status = r.statusById.get(id);
          if (status !== 'transferred') {
            const motivo = this.traduzirStatus(status || 'pendente');
            mensagem += `${id}: ${motivo}\n`;
          }
        });
      } else {
        mensagem += `(nenhum pendente)\n`;
      }

      if (incluirForaDeRota && r.foraDeRota.size > 0) {
        mensagem += `\nFora de rota:\n`;
        const foraOrdenados = Array.from(r.foraDeRota).sort();
        foraOrdenados.forEach(id => {
          mensagem += `${id}: fora de rota\n`;
        });
      }

      $('#mensagem-final').val(mensagem).removeClass('d-none');
      $('#copy-message').removeClass('d-none');
    },

    // ==========================
    // Importação HTML: várias rotas (se você colar vários htmls, salva todas)
    // ==========================
    importRoutesFromHtml(raw) {
      const source = String(raw || '');

      // tenta quebrar em blocos por routeId
      const idxs = [];
      for (const m of source.matchAll(/"routeId":\s*(\d+)/g)) idxs.push(m.index);
      if (!idxs.length) {
        this.alertar('Não encontrei nenhum "routeId" no HTML.');
        return 0;
      }

      const blocks = [];
      for (let i = 0; i < idxs.length; i++) {
        const start = idxs[i];
        const end = (i + 1 < idxs.length) ? idxs[i + 1] : source.length;
        blocks.push(source.slice(start, end));
      }

      let imported = 0;

      for (const blockRaw of blocks) {
        // seu código atual “limpa tags” pra facilitar regex
        let html = blockRaw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

        const routeMatch = /"routeId":\s*(\d+)/.exec(html);
        if (!routeMatch) continue;

        const routeId = String(routeMatch[1]);
        const r = this.routes.get(routeId) || this.makeEmptyRoute(routeId);

        // ORHC e %DS (mesmos regex do seu)
        let orhcMatch = /<div class="metric-box__value"><p>(\d{1,2}:\d{2}\s*h)<\/p><\/div>/i.exec(blockRaw);
        if (!orhcMatch) orhcMatch = /(\d{1,2}:\d{2}\s*h)/i.exec(blockRaw);
        r.orhc = orhcMatch ? orhcMatch[1] : (r.orhc || '-');

        let dsMatch = /<div class="chart-details-data__value-item">([\d.,]+)\s*<!-- -->\s*%<\/div>/i.exec(blockRaw);
        if (!dsMatch) dsMatch = /([\d.,]+)\s*%/i.exec(blockRaw);
        r.percentualDS = dsMatch ? `${dsMatch[1]} %` : (r.percentualDS || '0 %');

        // cluster, destino, motorista
        const clusterMatch = /"cluster":"([^"]+)"/.exec(html);
        if (clusterMatch) r.cluster = clusterMatch[1];

        const facMatch = /"destinationFacilityId":"([^"]+)","name":"([^"]+)"/.exec(html);
        if (facMatch) {
          r.destinationFacilityId = facMatch[1];
          r.destinationFacilityName = facMatch[2];
        }

        const driverMatch = /"driverName":"([^"]+)"/.exec(html);
        if (driverMatch) r.driverName = driverMatch[1];

        // zera conjuntos dessa rota (reimport substitui)
        r.ids.clear();
        r.conferidos.clear();
        r.foraDeRota.clear();
        r.duplicados.clear();
        r.timestamps.clear();
        r.statusById.clear();

        // ===== SEU PADRÃO: extrai IDs e substatus, guardando só o que NÃO é delivered/transferred
        const matches = [...html.matchAll(
          /"id":(4\d{10}).*?"substatus":\s*(null|"([^"]*)")/g
        )];

        const idsPendentes = [];
        for (const m of matches) {
          const id = m[1];
          const sub = (m[2] === 'null' || m[2] == null) ? null : (m[3] || '').trim();

          r.statusById.set(id, sub);

          if (sub !== 'delivered' && sub !== 'transferred') {
            idsPendentes.push(id);
          }
        }

        if (!idsPendentes.length) continue;
        idsPendentes.forEach(id => r.ids.add(id));

        this.routes.set(routeId, r);
        imported++;
      }

      this.saveToStorage();
      this.renderRoutesSelects();
      return imported;
    },

    // ==========================
    // XLSX: exporta rota atual (igual o seu, só lendo da rota atual)
    // ==========================
    exportXlsxRotaAtual() {
      const r = this.current;
      if (!r) return this.alertar('Selecione uma rota.');

      if (typeof XLSX === 'undefined') {
        return this.alertar('Biblioteca XLSX não carregada.');
      }

      const ws_data = [['ID', 'Status', 'Situação', 'Horário conferência']];

      r.conferidos.forEach(id => {
        ws_data.push([
          id,
          this.traduzirStatus(r.statusById.get(id) || 'pendente'),
          'Recebido',
          r.timestamps.get(id) || ''
        ]);
      });

      r.ids.forEach(id => {
        ws_data.push([
          id,
          this.traduzirStatus(r.statusById.get(id) || 'pendente'),
          'Pendente',
          ''
        ]);
      });

      r.foraDeRota.forEach(id => {
        ws_data.push([
          id,
          'Fora de rota',
          'Fora de rota',
          r.timestamps.get(id) || ''
        ]);
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(ws_data);
      XLSX.utils.book_append_sheet(wb, ws, 'Conferencia');

      const nomeArquivo = `Conferencia_Rota_${r.routeId || 'sem_rota'}.xlsx`;
      XLSX.writeFile(wb, nomeArquivo);
    },

    // ==========================
    // FECHAMENTO DIÁRIO
    // ==========================
    initFechamentoUI() {
      // data padrão (hoje)
      const $data = $('#fd-data');
      if ($data.length && !$data.val()) {
        const now = new Date();
        const pad2 = (n) => String(n).padStart(2, '0');
        $data.val(`${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`);
      }
    },

    getSelectedFechamentoRouteIds() {
      const sel = document.getElementById('fd-rotas');
      if (!sel) return [];
      return Array.from(sel.selectedOptions || []).map(o => String(o.value)).filter(Boolean);
    },

    rebuildFechamentoRouteTable() {
      const ids = this.getSelectedFechamentoRouteIds();
      const $tbody = $('#fd-rotas-tbody');
      if (!$tbody.length) return;

      const rows = [];
      for (const rid of ids) {
        const r = this.routes.get(String(rid));
        if (!r) continue;
        rows.push(`
          <tr data-routeid="${r.routeId}">
            <td><strong>Rota ${r.routeId}</strong><br><small class="text-muted">${r.cluster || ''}</small></td>
            <td>${r.driverName || '<span class="text-muted">—</span>'}</td>
            <td style="width:140px">
              <input type="number" class="form-control form-control-sm fd-insucesso-rota" min="0" value="${r.ids.size}">
            </td>
          </tr>
        `);
      }

      $tbody.html(rows.join(''));
      this.recalcFechamentoTotals();
    },

    recalcFechamentoTotals() {
      let totalInsucessos = 0;

      $('#fd-rotas-tbody tr').each(function () {
        const v = Number($(this).find('.fd-insucesso-rota').val() || 0);
        totalInsucessos += isFinite(v) ? v : 0;
      });

      $('#fd-total-insucessos').val(totalInsucessos);

      // sugere Total de Pacotes = totalInsucessos (como seu cenário é só insucesso por rota)
      const $tp = $('#fd-total-pacotes');
      if ($tp.length && ($tp.val() === '' || Number($tp.val()) === 0)) {
        $tp.val(totalInsucessos);
      }

      // pendentes sugere = totalInsucessos se vazio
      const $pend = $('#fd-pendentes');
      if ($pend.length && ($pend.val() === '' || Number($pend.val()) === 0)) {
        $pend.val(totalInsucessos);
      }
    },

    preencherSugestoesFechamento() {
      // se rodacoop vazio, sugere soma das rotas selecionadas (insuccessos extraídos)
      const ids = this.getSelectedFechamentoRouteIds();
      let soma = 0;
      for (const rid of ids) {
        const r = this.routes.get(String(rid));
        if (r) soma += r.ids.size;
      }

      const $rodacoop = $('#fd-rodacoop');
      if ($rodacoop.length && ($rodacoop.val() === '' || Number($rodacoop.val()) === 0)) {
        $rodacoop.val(soma);
      }

      this.recalcFechamentoTotals();
    },

  gerarMensagemFechamento() {
  const getV = (id) => String($(`#${id}`).val() ?? '').trim();

  const dataISO = getV('fd-data');
  const base = getV('fd-base') || '';
  const ciclo = getV('fd-ciclo') || 'AM';

  const fmtDataBR = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return iso || '';
    return `${m[3]}/${m[2]}/${m[1]}`;
  };

  const solicitados = getV('fd-solicitados');
  const carregados = getV('fd-carregados');
  const rodacoop = getV('fd-rodacoop');
  const noshow = getV('fd-noshow');
  const backups = getV('fd-backups');
  const ambulancia = getV('fd-ambulancia');

  const performance = getV('fd-performance');
  const pendentes = getV('fd-pendentes');
  const insucessosGeral = getV('fd-insucessos');
  const reclamacao = getV('fd-reclamacao');

  const totalPacotes = getV('fd-total-pacotes');
  const totalInsucessos = getV('fd-total-insucessos');

  // ====== Blocos por rota no formato que você pediu ======
  const blocosRotas = [];
  const selectedRouteIds = this.getSelectedFechamentoRouteIds();

  for (const rid of selectedRouteIds) {
    const r = this.routes.get(String(rid));
    if (!r) continue;

    // prioridade: cluster (ex: J20_AM7) -> senão routeId
    const rotaLabel = (r.cluster && r.cluster.trim()) ? r.cluster.trim() : r.routeId;

    // motorista
    const motorista = (r.driverName && r.driverName.trim()) ? r.driverName.trim() : '(não informado)';

    // lista de IDs pendentes/insucesso desta rota com motivo (substatus traduzido)
    const idsOrdenados = Array.from(r.ids).sort((a, b) => String(a).localeCompare(String(b)));

    const linhasIds = idsOrdenados.map(id => {
      const sub = r.statusById.get(id); // pode ser null
      const motivo = this.traduzirStatus(sub || 'pendente');
      return `${id}: ${motivo}`;
    });

    const bloco =
`♎ Justificativa:
Rota ${rotaLabel}
Rodacoop | ${motorista}

${linhasIds.length ? linhasIds.join('\n') : '(sem IDs de insucesso)'}
`.trim();

    blocosRotas.push(bloco);
  }

  const msg =
`RELATÓRIO RODACOOP ${base} 🚀
${fmtDataBR(dataISO)} - Data do dia do fechamento
————————————————————
Ciclo ${ciclo}
Base: ${base}  RODACOOP
————————————————————
SOLICITADOS: ${solicitados}
CARREGADOS: ${carregados}
RODACOOP: ${rodacoop}
NOSHOW: ${noshow}
BACKUPS: ${backups}
AMBULÂNCIA: ${ambulancia}

PERFORMANCE: ${performance}
PENDENTES : ${pendentes}
INSUCESSOS: ${insucessosGeral}
RECLAMAÇÃO: ${reclamacao}

Total de Pacotes: ${totalPacotes}
Total de Insucessos: ${totalInsucessos}

${blocosRotas.join('\n\n')}
`.trim();

  $('#fd-output').val(msg);
  },


    copiarFechamento() {
      const text = ($('#fd-output').val() || '').trim();
      if (!text) return alert('Gere a mensagem antes.');

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => alert('Mensagem copiada!')).catch(() => {
          const ta = document.getElementById('fd-output');
          ta.select();
          document.execCommand('copy');
          alert('Mensagem copiada!');
        });
      } else {
        const ta = document.getElementById('fd-output');
        ta.select();
        document.execCommand('copy');
        alert('Mensagem copiada!');
      }
    }
  };

  // ==========================
  // INIT
  // ==========================
  ConferenciaApp.loadFromStorage();
  ConferenciaApp.renderRoutesSelects();

  // ==========================
  // BOTÕES / EVENTOS
  // ==========================

  // importar/salvar do HTML (várias rotas)
  $('#extract-btn').click(() => {
    const raw = $('#html-input').val() || '';
    if (!raw.trim()) return ConferenciaApp.alertar('Cole o HTML antes.');

    const qtd = ConferenciaApp.importRoutesFromHtml(raw);
    if (!qtd) return ConferenciaApp.alertar('Nenhuma rota importada (ou sem IDs pendentes).');

    ConferenciaApp.alertar(`${qtd} rota(s) importada(s) e salva(s)! Selecione uma rota e clique em “Carregar rota”.`);
    $('#html-input').val('');
  });

  // carregar rota selecionada
  $('#load-route').click(() => {
    const id = $('#saved-routes').val();
    if (!id) return ConferenciaApp.alertar('Selecione uma rota salva.');
    ConferenciaApp.setCurrentRoute(id);

    $('#initial-interface').addClass('d-none');
    $('#manual-interface').addClass('d-none');
    $('#conference-interface').removeClass('d-none');
    $('#barcode-input').focus();
  });

  // trocar rota dentro da conferência
  $('#switch-route').click(() => {
    const id = $('#saved-routes-inapp').val();
    if (!id) return;
    ConferenciaApp.setCurrentRoute(id);
    $('#barcode-input').focus();
  });

  $('#delete-route').click(() => {
    const id = $('#saved-routes').val();
    if (!id) return ConferenciaApp.alertar('Selecione uma rota para excluir.');
    ConferenciaApp.deleteRoute(id);
  });

  $('#clear-all-routes').click(() => {
    ConferenciaApp.clearAllRoutes();
    ConferenciaApp.alertar('Todas as rotas foram removidas.');
  });

  // manual
  $('#manual-btn').click(() => {
    $('#initial-interface').addClass('d-none');
    $('#manual-interface').removeClass('d-none');
  });

  $('#submit-manual').click(() => {
    const r = ConferenciaApp.current;
    if (!r) return ConferenciaApp.alertar('Carregue uma rota antes (ou importe do HTML e carregue).');

    const manualIds = ($('#manual-input').val() || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
    if (!manualIds.length) return ConferenciaApp.alertar('Nenhum ID válido.');

    manualIds.forEach(id => r.ids.add(id));
    ConferenciaApp.saveToStorage();
    ConferenciaApp.refreshUIFromCurrent();

    $('#manual-interface').addClass('d-none');
    $('#conference-interface').removeClass('d-none');
  });

  // CSV
  $('#check-csv').click(() => {
    const r = ConferenciaApp.current;
    if (!r) return ConferenciaApp.alertar('Selecione uma rota antes.');

    const file = $('#csv-input')[0].files[0];
    if (!file) return ConferenciaApp.alertar('Selecione um arquivo CSV primeiro.');

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

  // export xlsx (rota atual)
  $('#export-xlsx').click(() => {
    ConferenciaApp.exportXlsxRotaAtual();
  });

  // mensagem atual (rota atual)
  $('#generate-message').click(() => {
    ConferenciaApp.gerarMensagemResumo({ incluirForaDeRota: true });
  });

  $('#copy-message').click(() => {
    const txt = $('#mensagem-final').val();
    if (!txt) return;
    navigator.clipboard.writeText(txt).catch(() => {
      $('#mensagem-final')[0].select();
      document.execCommand('copy');
    });
  });

  // voltar
  $('#back-btn').click(() => {
    $('#conference-interface').addClass('d-none');
    $('#initial-interface').removeClass('d-none');
    $('#html-input, #csv-input, #barcode-input').val('');
    $('#progress-bar').css('width', '0%').text('0%');

    $('#mensagem-final').val('').addClass('d-none');
    $('#copy-message').addClass('d-none');

    const el = document.getElementById('input-origin');
    if (el) el.textContent = '—';
  });

  // ========= detectar MANUAL vs LEITOR =========
  let scanBuffer = '';
  let lastKeyTime = 0;
  let origemEntrada = 'manual';
  const SCAN_THRESHOLD = 60;

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

      if (id) ConferenciaApp.conferirId(id, origemEntrada);

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

  // ==========================
  // FECHAMENTO DIÁRIO: abrir/voltar/gerar/copiar
  // ==========================
  $('#fechamento-btn').click(() => {
    $('#initial-interface').addClass('d-none');
    $('#manual-interface').addClass('d-none');
    $('#conference-interface').addClass('d-none');
    $('#fechamento-interface').removeClass('d-none');

    ConferenciaApp.initFechamentoUI();
    ConferenciaApp.rebuildFechamentoRouteTable();
  });

  $('#fd-voltar').click(() => {
    $('#fechamento-interface').addClass('d-none');
    $('#initial-interface').removeClass('d-none');
  });

  $('#fd-rotas').on('change', () => {
    ConferenciaApp.rebuildFechamentoRouteTable();
  });

  $('#fd-selecionar-todas').click(() => {
    const sel = document.getElementById('fd-rotas');
    if (!sel) return;
    for (const opt of Array.from(sel.options)) opt.selected = true;
    ConferenciaApp.rebuildFechamentoRouteTable();
  });

  $('#fd-preencher-sugestoes').click(() => {
    ConferenciaApp.preencherSugestoesFechamento();
  });

  $(document).on('input', '.fd-insucesso-rota', () => {
    ConferenciaApp.recalcFechamentoTotals();
  });

  $('#fd-gerar').click(() => {
    ConferenciaApp.recalcFechamentoTotals();
    ConferenciaApp.gerarMensagemFechamento();
  });

  $('#fd-copiar').click(() => {
    ConferenciaApp.copiarFechamento();
  });
});

