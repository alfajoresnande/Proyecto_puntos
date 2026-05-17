export function scrollPageToTop(behavior: ScrollBehavior = "smooth") {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior });

    document.querySelectorAll<HTMLElement>("[data-scroll-root], .admin-content").forEach((element) => {
      element.scrollTo({ top: 0, left: 0, behavior });
    });
  });
}

