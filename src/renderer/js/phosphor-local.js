var head = document.getElementsByTagName("head")[0];

const root = window._appRoot || '';
for (const weight of ["regular", "thin", "light", "bold", "fill", "duotone"]) {
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.type = "text/css";
  link.href = `${root}node_modules/@phosphor-icons/web/src/${weight}/style.css`;
  head.appendChild(link);
}
