// Shared header/footer markup for the generated bar pages.
// Keep in sync with the static header/footer in botecar/index.html.

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

const ICONS = {
  walk: svg("M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"),
  car: svg("M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"),
  pin: svg("M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"),
  clock: svg("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"),
  insta: svg("M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2zm-.2 2A3.6 3.6 0 0 0 4 7.6v8.8A3.6 3.6 0 0 0 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6A3.6 3.6 0 0 0 16.4 4H7.6zm9.65 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"),
  music: svg("M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"),
  map: svg("M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"),
  back: svg("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"),
};

function renderHead({ title, description, root }) {
  return `  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description.replace(/"/g, "&quot;")}">
  <meta name="theme-color" content="#ed7623">
  <link rel="icon" href="${root}assets/fav.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="${root}css/style.css" rel="stylesheet">`;
}

function renderHeader({ root }) {
  return `  <header class="navbar">
    <a class="logo" href="${root}"><img src="${root}assets/fav.svg" alt="Festival Botecar" width="56" height="56"></a>
    <nav class="menu">
      <ul>
        <li><a href="${root}">Botecos perto de casa</a></li>
        <li><a href="https://www.festivalbotecar.com.br/rio/" target="_blank" rel="noopener">Site oficial</a></li>
      </ul>
    </nav>
    <span class="navbar-origem">rotas desde a Rua do Bispo, 295</span>
  </header>`;
}

function renderFooter({ root }) {
  return `  <footer class="footer">
    <div class="footer-badge"><img src="${root}assets/fav.svg" alt="Festival Botecar" width="90" height="90"></div>
    <nav class="footer-menu">
      <ul>
        <li><a href="${root}">Botecos perto de casa</a></li>
        <li><a href="https://www.festivalbotecar.com.br/rio/pratos.html" target="_blank" rel="noopener">Pratos oficiais</a></li>
        <li><a href="https://www.festivalbotecar.com.br/rio/mapa.html" target="_blank" rel="noopener">Mapa oficial</a></li>
        <li><a href="https://www.instagram.com/festival_botecar/" target="_blank" rel="noopener">@festival_botecar</a></li>
      </ul>
    </nav>
    <p class="footer-nota">Guia pessoal e não oficial, feito com os dados do Festival Botecar Rio 2026.<br>Rotas reais do Google Maps a partir da Rua do Bispo, 295 — Rio Comprido.</p>
  </footer>`;
}

module.exports = { ICONS, renderHead, renderHeader, renderFooter };
