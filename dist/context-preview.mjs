import { cardHTML, icon } from './cards.mjs';

// One coherent example report: monthly revenue totals match the category table.
const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep'];
const revenue = [108, 121, 114, 137, 143, 132, 155, 163, 172];
const priorRevenue = [96, 105, 102, 120, 123, 117, 136, 146, 151];
const orders = [1560, 1780, 1630, 1850, 2050, 1970, 2340, 2350, 2890];
const categories = [['Bicicletas', 650000], ['Componentes', 315000], ['Accesorios', 175000], ['Ropa', 105000]];
const number = new Intl.NumberFormat('es-ES');
const percent = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

function revenueChart() {
  const x = i => 52 + i * 78;
  const y = value => 264 - value * 1.14;
  const points = values => values.map((v, i) => `${x(i)},${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 720 304" class="context-revenue-chart" role="img" aria-label="Ingresos mensuales de enero a septiembre de 2026, entre 108 y 172 mil euros, comparados con 2025">
    ${[0, 50, 100, 150, 200].map(v => `<g class="context-chart-grid"><line x1="52" x2="704" y1="${y(v)}" y2="${y(v)}"/><text x="40" y="${y(v) + 4}" text-anchor="end">${v}</text></g>`).join('')}
    <polygon points="52,264 ${points(revenue)} 676,264" class="context-chart-area"/>
    <polyline points="${points(priorRevenue)}" class="context-chart-prior"/>
    <polyline points="${points(revenue)}" class="context-chart-current"/>
    <circle cx="676" cy="${y(172)}" r="4" class="context-chart-dot"/>
    <text x="676" y="${y(172) - 13}" text-anchor="middle" class="context-chart-end-label">172</text>
    ${months.map((month, i) => `<text x="${x(i)}" y="289" text-anchor="middle" class="context-chart-month">${month}</text>`).join('')}
  </svg>`;
}

function orderSparkline() {
  return `<svg viewBox="0 0 240 48" class="context-order-spark" role="img" aria-label="Pedidos mensuales: 1.560 en enero y 2.890 en septiembre">
    ${orders.map((value, i) => { const h = Math.round(value / 2890 * 38); return `<rect x="${i * 27}" y="${44 - h}" width="16" height="${h}" rx="3" class="${i === 8 ? 'is-last' : ''}"/>`; }).join('')}
  </svg>`;
}

export function contextCardGeometry(c, width, height) {
  const availableWidth = (width - 2 - 48 - 24) / 2.45;
  const availableHeight = height - 2 - 76 - 40 - 170 - 16 - 16;
  const scale = Math.min(1, availableWidth / c.width, availableHeight / c.height);
  return {scale,width:c.width*scale,height:c.height*scale};
}

export function contextReport(c, width, height) {
  const total = categories.reduce((sum, [,value]) => sum + Number(value), 0);
  const card=contextCardGeometry(c,width,height);
  return `<div class="context-report-canvas" id="context-viewport" style="width:${width}px;height:${height}px">
    <header class="context-report-topbar">
      <div class="context-topbar-left"><span class="context-report-title">Resumen comercial</span><span class="context-report-subtitle">Enero–septiembre 2026 · Ejemplo de informe</span></div>
      <div class="context-topbar-slicers"><span class="context-slicer">Año <strong>2026</strong></span><span class="context-slicer">Período <strong>Ene–Sep</strong></span><span class="context-slicer">Región <strong>Todas</strong></span></div>
    </header>
    <div class="context-report-grid">
      <div class="context-card-column">
        <div class="context-card-area"><div class="context-card-slot active-card-slot" style="width:${card.width}px;height:${card.height}px"><div class="context-card-fit" style="width:${c.width}px;height:${c.height}px;transform:scale(${card.scale})">${cardHTML(c)}</div></div></div>
        <span class="context-card-caption">${icon('card',12)} Tu tarjeta · ${c.width} × ${c.height} px${card.scale<1?` · ${Math.round(card.scale*100)} %`:''}</span>
        <section class="context-mock-visual categories-visual" aria-label="Ingresos por categoría">
          <div class="mock-visual-head"><strong>Ingresos por categoría</strong><small>Acumulado · euros</small></div>
          <table class="context-category-table"><thead><tr><th>Categoría</th><th>Ingresos</th><th>Cuota</th></tr></thead><tbody>
            ${categories.map(([name, value]) => `<tr><th scope="row"><span>${name}</span><i class="context-category-bar" style="--category-share:${Number(value) / total * 100}%"></i></th><td>${number.format(Number(value))} €</td><td>${percent.format(Number(value) / total * 100)} %</td></tr>`).join('')}
          </tbody></table>
        </section>
      </div>
      <div class="context-report-support">
        <div class="context-kpis-row">
          <section class="context-mock-kpi" aria-label="Margen bruto">
            <span class="mock-kpi-label">Margen bruto</span><strong class="mock-kpi-val">34,8 <small>%</small></strong><span class="mock-kpi-delta">↗ 2,4 p. p. <small>respecto a 2025</small></span>
            <div class="context-goal-caption"><span>Objetivo anual</span><strong>32,0 %</strong></div><div class="mock-kpi-bar"><span></span><i title="Objetivo: 32,0 %"></i></div>
          </section>
          <section class="context-mock-kpi" aria-label="Pedidos">
            <span class="mock-kpi-label">Pedidos</span><strong class="mock-kpi-val">18.420</strong><span class="mock-kpi-delta">↗ 8,6 % <small>respecto a 2025</small></span>${orderSparkline()}<div class="context-spark-labels"><span>Ene</span><span>Sep</span></div>
          </section>
        </div>
        <section class="context-mock-visual chart-visual" aria-label="Evolución mensual de ingresos">
          <div class="mock-visual-head"><div><strong>Ingresos por mes</strong><small>Miles de euros · enero–septiembre</small></div><span class="context-chart-total">1,25 M €<small>Acumulado 2026</small></span></div>
          <div class="context-chart-legend"><span><i></i>2026</span><span><i class="is-prior"></i>2025</span></div>${revenueChart()}
          <p class="context-chart-note">Septiembre: 172.000 € <span>+13,9 % interanual</span></p>
        </section>
      </div>
    </div>
  </div>`;
}
