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

});
