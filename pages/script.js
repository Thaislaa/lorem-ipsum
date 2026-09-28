const botaoMenu = document.querySelector(".botao-menu");
const menuNav = document.querySelector(".menu-nav");

botaoMenu.addEventListener("click", function () {

    if (menuNav.style.display === "none" || menuNav.style.display === "") {
        menuNav.style.display = "block";
        menuNav.classList.add("aberto");
    } else {
        menuNav.style.display = "none";
        menuNav.classList.remove("aberto");
    }

});

document.addEventListener("click", function (event) {
    if (menuNav.classList.contains("aberto") &&
        !menuNav.contains(event.target) &&
        !botaoMenu.contains(event.target)) {

        menuNav.style.display = "none";
        menuNav.classList.remove("aberto");
    }
});

window.addEventListener("scroll", function () {
    if (menuNav.classList.contains("aberto")) {
        menuNav.style.display = "none";
        menuNav.classList.remove("aberto");
    }
});

window.addEventListener("resize", function () {
    if (window.innerWidth > 795) {
        menuNav.style.display = "";
        menuNav.classList.remove("aberto");
    }
});
