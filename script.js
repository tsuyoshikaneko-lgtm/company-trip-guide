document.addEventListener('DOMContentLoaded', () => {

  // Tab Switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  const timelines = document.querySelectorAll('.timeline');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from all tabs
      tabBtns.forEach(t => t.classList.remove('active'));
      // Hide all timelines
      timelines.forEach(t => t.classList.add('hidden'));

      // Add active to clicked tab
      btn.classList.add('active');

      // Show target timeline
      const targetId = btn.getAttribute('data-target');
      document.getElementById(targetId).classList.remove('hidden');
    });
  });

  // Floating Bear Scrolling Logic
  const mascot = document.getElementById('mascot');
  const messageBubble = document.getElementById('bear-message');

  const messages = [
    "おおっ！山がたくさん！🐻",
    "お弁当はまだかな？🍱",
    "遅刻しちゃダメだよ！⏰",
    "発酵ってなんだろう？🍶",
    "スクロール楽しいね！🎢",
    "一緒に歩こう！🐾",
  ];

  let lastScrollTop = 0;

  window.addEventListener('scroll', () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    // Hide mascot if scrolling up very fast, reveal when scrolling down
    // (Optional - right now just keeping it visible and wiggling)

    // Change speech bubble occasionally based on scroll amount
    if (Math.abs(scrollTop - lastScrollTop) > document.body.scrollHeight / 8) {
      const randomMsg = messages[Math.floor(Math.random() * messages.length)];
      messageBubble.textContent = randomMsg;
      lastScrollTop = scrollTop;

      // Add a slight bounce to the mascot
      mascot.style.transform = "scale(1.1) rotate(5deg)";
      setTimeout(() => {
        mascot.style.transform = "scale(0.9) rotate(0deg)";
      }, 300);
    }

    // Hide bear near the bottom so it doesn't overlap the footer bear
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 150) {
      mascot.classList.add('hide');
    } else {
      mascot.classList.remove('hide');
    }
  });

  // Kuroko Animation
  const kuroko = document.getElementById('kuroko');
  const sections = document.querySelectorAll('.section');
  if (kuroko && sections.length > 0) {
    let kurokoScrollAccumulator = 0;
    let lastKurokoScroll = window.pageYOffset || document.documentElement.scrollTop;
    let kurokoIsPeeking = false;
    let kurokoTimeout;
    let debounceScroll;

    window.addEventListener('scroll', () => {
      const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
      const delta = Math.abs(currentScroll - lastKurokoScroll);
      kurokoScrollAccumulator += delta;
      lastKurokoScroll = currentScroll;

      // When we've scrolled enough, wait for the scroll to slow down/stop before popping
      if (kurokoScrollAccumulator > 350 && !kurokoIsPeeking) {
        clearTimeout(debounceScroll);

        debounceScroll = setTimeout(() => {
          if (kurokoIsPeeking) return;
          kurokoScrollAccumulator = 0;

          // Find visible sections focused in the middle of the screen
          const visibleSections = Array.from(sections).filter(sec => {
            const rect = sec.getBoundingClientRect();
            // Ensure section is well within the viewport so the user can easily see it
            return rect.top < window.innerHeight * 0.8 && rect.bottom > window.innerHeight * 0.2;
          });

          if (visibleSections.length > 0) {
            const targetSection = visibleSections[Math.floor(Math.random() * visibleSections.length)];
            const rect = targetSection.getBoundingClientRect();

            // Absolute document coordinates calculation
            const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
            const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;

            // Pick random direction: 0(left), 1(right), 2(top), 3(bottom)
            // Weight left and right slightly higher for better aesthetics
            const rand = Math.random();
            let direction = 0; // left
            if (rand > 0.35 && rand <= 0.7) direction = 1; // right
            else if (rand > 0.7 && rand <= 0.85) direction = 2; // top
            else if (rand > 0.85) direction = 3; // bottom

            kuroko.className = 'kuroko-link'; // reset classes

            if (direction === 0) { // left
              const randomY = Math.max(0, rect.height - 100);
              kuroko.style.top = (scrollY + rect.top + Math.random() * randomY) + 'px';
              kuroko.style.left = (scrollX + rect.left + 5) + 'px';
              kuroko.classList.add('k-left');
            } else if (direction === 1) { // right
              const randomY = Math.max(0, rect.height - 100);
              kuroko.style.top = (scrollY + rect.top + Math.random() * randomY) + 'px';
              kuroko.style.left = (scrollX + rect.right - 90 - 5) + 'px';
              kuroko.classList.add('k-right');
            } else if (direction === 2) { // top
              const randomX = Math.max(0, rect.width - 90);
              kuroko.style.left = (scrollX + rect.left + Math.random() * randomX) + 'px';
              kuroko.style.top = (scrollY + rect.top + 5) + 'px';
              kuroko.classList.add('k-top');
            } else { // bottom
              const randomX = Math.max(0, rect.width - 90);
              kuroko.style.left = (scrollX + rect.left + Math.random() * randomX) + 'px';
              kuroko.style.top = (scrollY + rect.bottom - 100 - 5) + 'px';
              kuroko.classList.add('k-bottom');
            }

            // Force layout recalculation
            void kuroko.offsetWidth;

            // Peek
            kuroko.classList.add('peek');
            kurokoIsPeeking = true;

            // Keep it out a bit longer so it's easier to hit
            clearTimeout(kurokoTimeout);
            kurokoTimeout = setTimeout(() => {
              kuroko.classList.remove('peek');
              setTimeout(() => {
                kurokoIsPeeking = false;
              }, 400); // Wait for CSS transition
            }, 2500); // Increased visibility time to 2.5 seconds
          }
        }, 150); // wait 150ms after scrolling stops/slows before showing
      }
    });
  }

});
