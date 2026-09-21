const botaoMenu = document.querySelector(".botao-menu");
const menuNav = document.querySelector(".menu-nav");

botaoMenu.addEventListener("click", function () {

    if (menuNav.style.display === "none" || menuNav.style.display === "") {
        menuNav.style.display = "block";
        menuNav.classList.add("aberto");
        document.body.style.overflow = "hidden";
    } else {
        menuNav.style.display = "none";
        menuNav.classList.remove("aberto");
        document.body.style.overflow = "auto";
    }

});