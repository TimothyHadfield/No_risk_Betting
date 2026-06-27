"use strict";
/*
 * "Our Purpose" view — the mission of this app plus a researched, cited paper on
 * the harms of real-money sports betting and the predatory design of the
 * industry. Summary + stat callouts up top; the full paper sits behind a
 * "Learn more" reveal. Every numeric claim is footnoted to a source with a
 * direct URL in the Works Cited list. Owns: purpose.js / purpose.css.
 *
 * Sources were gathered and adversarially fact-checked (see the project's
 * research pass); shaky/uncited stats were deliberately excluded.
 */
(function () {
  const NRB = window.NRB;

  // ---- references (ordered; the number shown = index + 1) ------------------
  // Edit text/url here and the inline [n] links + Works Cited stay in sync.
  const REFS = [
    { id: "aga2024", cite: "ESPN (reporting American Gaming Association data), “U.S. sports betting industry posts record $13.7B revenue in 2024” (2025).", url: "https://www.espn.com/espn/betting/story/_/id/43922129/us-sports-betting-industry-posts-record-137b-revenue-24" },
    { id: "foxvig", cite: "FOX Sports, “What Is the Vig in Sports Betting and How Does It Work?”", url: "https://www.foxsports.com/stories/betting/what-is-the-vig" },
    { id: "njdge", cite: "InGame, “New Jersey November Sports Betting Revenue”, reporting NJ Division of Gaming Enforcement data (2025). Primary monthly reports: NJ Office of the Attorney General, Division of Gaming Enforcement.", url: "https://www.ingame.com/new-jersey-november-sports-betting-revenue/" },
    { id: "levitt", cite: "Steven D. Levitt, “Why are Gambling Markets Organised so Differently from Financial Markets?”, The Economic Journal 114(495):223–246 (2004).", url: "https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1468-0297.2004.00207.x" },
    { id: "nber", cite: "Baker, Balthrop, Johnson, Kotter & Pisciotta, “Gambling Away Stability: Sports Betting’s Impact on Vulnerable Households”, NBER Working Paper 33108 (2024). [Working paper — not yet peer-reviewed.]", url: "https://www.nber.org/papers/w33108" },
    { id: "hollenbeck", cite: "Hollenbeck, Larsen & Proserpio, “The Financial Consequences of Legalized Sports Gambling” (UCLA/USC, 2025; accepted ACM EC 2025). [Working paper.]", url: "https://www.anderson.ucla.edu/sites/default/files/document/2025-05/Hollenbeck_The_Financial_Consequences_of_Legalized_Sports_Gambling.pdf" },
    { id: "nyfed", cite: "Federal Reserve Bank of New York, Staff Report (on legalized sports betting and household finances).", url: "https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr1184.pdf" },
    { id: "cfpb", cite: "Consumer Financial Protection Bureau, Data Spotlight: “Credit card cash advance fees spike after legalization of sports gambling” (2024).", url: "https://www.consumerfinance.gov/data-research/research-reports/data-spotlight-credit-card-cash-advance-fees-spike-after-legalization-of-sports-gambling/" },
    { id: "kellogg", cite: "Kellogg Insight (Northwestern), “Online Sports Betting Is Draining Household Savings” (2024), summarizing the transaction-level study.", url: "https://insight.kellogg.northwestern.edu/article/online-sports-betting-is-draining-household-savings" },
    { id: "norway", cite: "Fiedler et al., “Concentration of gambling spending by product type: analysis of gambling accounts records in Norway”, Addiction Research & Theory (2024).", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11934949/" },
    { id: "wsjlimit", cite: "Wall Street Journal, “Sports-Betting Companies Weed Out Winners. Gamblers Want to Know Why” (2024). [Paywalled; corroborated by NBER WP 33108.]", url: "https://www.wsj.com/business/media/sports-betting-companies-limit-winners-f06ea822" },
    { id: "lancet", cite: "The Lancet Public Health Commission on gambling (2024); companion systematic review/meta-analysis (Tran et al.).", url: "https://www.thelancet.com/journals/lanpub/article/PIIS2468-2667(24)00167-1/fulltext" },
    { id: "ncpg", cite: "National Council on Problem Gambling, NGAGE 3.0 Key Findings (2025).", url: "https://www.ncpgambling.org/wp-content/uploads/2025/06/NGAGE-3.0-Key-Findings-FINAL-FOR-DISTRIBUTION.pdf" },
    { id: "suicide", cite: "Wardle & McManus, “Suicidality and gambling among young adults in Great Britain”, The Lancet Public Health (2021).", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7788474/" },
    { id: "ipv", cite: "Matsuzawa & Arnesen, “Sports Betting Legalization Amplifies Emotional Cues & Intimate Partner Violence” (Univ. of Oregon, 2024). [Working paper.]", url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4938642" },
    { id: "cog", cite: "Mansour et al., “Langer’s illusion of control and the cognitive model of disordered gambling” (2021); Goodie & Fortune, meta-analysis of gambling cognitions (2013).", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9292938/" },
    { id: "wapo", cite: "The Washington Post, “How sportsbooks’ VIP programs keep bettors playing” (April 2025). [Paywalled.]", url: "https://www.washingtonpost.com/sports/2025/04/04/sportsbooks-vip-programs-loyalty-hosts/" },
    { id: "guardian", cite: "The Guardian, “US gambling giants face scrutiny over VIP programs” (Feb 2025); UK Gambling Commission VIP findings.", url: "https://www.theguardian.com/society/2025/feb/24/us-gambling-vip-programs" },
    { id: "espnlimit", cite: "ESPN (David Purdum), “Sportsbooks defend practice of limiting how much sharp customers can bet” (2024).", url: "https://www.espn.com/sports-betting/story/_/id/41231266/espn-sports-betting-news-sportsbooks-defend-practice-limiting-sharp-customers" },
    { id: "ncl", cite: "National Consumers League, “Advertising sports betting with smartphone notifications” (2025).", url: "https://nclnet.org/advertising-sports-betting-with-smartphone-notifications-what-ncl-learned-and-how-regulators-can-act/" },
    { id: "sciam", cite: "Scientific American, “How ‘Dark Patterns’ in Sports Betting Apps Keep Users Gambling” (2025).", url: "https://www.scientificamerican.com/article/how-sports-betting-apps-use-psychology-to-keep-users-gambling/" },
    { id: "nyt", cite: "The New York Times, “How the Sports-Betting Industry Got So Big, So Fast” (2022). [Paywalled.]", url: "https://www.nytimes.com/2022/11/20/business/sports-betting-investigation.html" },
    { id: "mktbrew", cite: "Marketing Brew, “Sportsbooks’ TV ad spend during the NFL season” (2024).", url: "https://www.marketingbrew.com/stories/2024/10/04/sportsbooks-TV-ad-spend-NFL--DraftKings-FanDuel-BetMGM" },
    { id: "integrity", cite: "Fox News, “Looking back at the sports gambling controversies throughout 2025” (NBA & MLB federal cases; charges/allegations).", url: "https://www.foxnews.com/sports/looking-back-sports-gambling-controversies-throughout-2025-nba-mlb-investigations-leading-way" },
  ];
  const REF_INDEX = {};
  REFS.forEach((r, i) => { REF_INDEX[r.id] = i + 1; });

  // inline superscript citation, e.g. ...claim.[5]  (one or several ids)
  function cite() {
    const ids = Array.prototype.slice.call(arguments);
    return ids.map((id) => {
      const n = REF_INDEX[id];
      if (!n) return "";
      return `<a class="pp-ref-link" data-ref="${n}" title="Jump to source">[${n}]</a>`;
    }).join("");
  }

  // ---- the full paper body --------------------------------------------------
  function fullPaper() {
    return `
      <div class="pp-paper-head">
        <h2>The case against real-money sports betting</h2>
        <div class="pp-byline">A short, sourced review of the evidence · every number below links to its source</div>
      </div>

      <p class="pp-abstract">Legal mobile sports betting is barely seven years old in the United States, and the
        early data is already damning. It is mathematically a losing game by design, it has measurably pushed
        households into debt and bankruptcy, its revenue depends on a small number of people who cannot stop, and
        the apps themselves are engineered to keep you betting. This page lays out what the research actually
        says — and why we built a place to enjoy the same game without the money that ruins lives.</p>

      <div class="pp-section">
        <h3>1. The house always wins — on purpose</h3>
        <p>A sportsbook is not a neutral marketplace; it is a business that prices every bet to keep a cut. The
          standard −110 line you see on most bets bakes in about a <strong>4.76% “vig”</strong>, which means you
          have to win roughly <strong>52.4% of your bets just to break even</strong> — before you have made a single
          dollar of profit.${cite("foxvig")} In practice the books keep far more than that. Across the U.S. in 2024,
          Americans wagered nearly <strong>$150 billion</strong> legally and <strong>lost about $13.7 billion</strong> of
          it — a record “hold” of <strong>9.3%</strong> of everything bet.${cite("aga2024")}</p>
        <p>Parlays — the multi-leg bets the apps push hardest — are where the edge balloons. Because the vig
          compounds on every leg, the house keeps a far larger share: New Jersey regulator data for 2025 shows a
          parlay hold around <strong>18.7%</strong> versus about <strong>6.3%</strong> on straight football bets.${cite("njdge")}
          That is roughly triple the cost to you, which is exactly why “same-game parlay” promos are everywhere.</p>
        <p>This is not bad luck that evens out. A peer-reviewed analysis of betting markets found that
          “bookmakers are more skilled at predicting the outcomes of games than bettors and systematically exploit
          bettor biases.”${cite("levitt")} Over many bets, a negative expected return compounds toward near-certain
          loss — and on the rare occasion someone does win consistently, the books simply cut them off (see
          section 5). The game is structured so that the long run belongs to the house.</p>
      </div>

      <div class="pp-section">
        <h3>2. The financial wreckage</h3>
        <p>Two large causal studies — using real bank-transaction and credit-bureau records, not surveys — reach
          the same conclusion: legalizing online sports betting makes household finances worse.</p>
        <p>The first finds that betting is <strong>net-new spending that crowds out saving</strong>: for roughly every
          <strong>$1 deposited to a sportsbook, households cut their net investment by just under $1</strong>, with net
          investment falling about <strong>14%</strong> after legalization. The effect doesn’t correct itself — it grows
          over time. The damage concentrates among <strong>financially constrained households</strong>, where credit-card
          debt rises and overdrafts become more frequent.${cite("nber", "kellogg")}</p>
        <p>The second, using credit records for millions of consumers, finds that legal sports betting
          <strong>lowers credit scores, and raises bankruptcies, debt sent to collections, and auto-loan
          delinquencies</strong> — with the harm largest in states that allow online betting and among subprime
          borrowers.${cite("hollenbeck")} A New York Fed staff report and a Consumer Financial Protection Bureau
          analysis (which found a spike in credit-card cash-advance fees after legalization) point the same
          direction.${cite("nyfed", "cfpb")}</p>
        <p class="pp-note"><b>An honest caveat:</b> the two headline studies are recent working papers, not yet
          peer-reviewed, and the average effect across the whole population is modest because only a minority of
          people bet. But the effect on people who <em>actually</em> bet is far larger, and multiple independent
          datasets agree on the direction. We would rather show you the real, qualified evidence than a scarier
          number we can’t stand behind.</p>
      </div>

      <div class="pp-section">
        <h3>3. Who actually pays for it</h3>
        <p>The industry’s profits do not come evenly from millions of casual fans. They come overwhelmingly from a
          small group of heavy losers. In a study of real betting accounts, the <strong>top 10% of gamblers
          accounted for about 52% of all losses</strong> — and for sports betting specifically, the concentration was
          even more extreme: the <strong>top 10% generated about 79% of losses</strong>, the top 5% about 66%.${cite("norway")}</p>
        <p>In other words, the business model depends on the people least able to walk away — and the same research
          shows harms fall hardest on younger people, lower-income groups, and the financially vulnerable.${cite("lancet")}
          A product that needs its heaviest, most-harmed users to survive is not designed for your entertainment.
          You are the product.</p>
      </div>

      <div class="pp-section">
        <h3>4. The human cost</h3>
        <p>Gambling harm is now a global public-health problem. The Lancet Public Health Commission estimates that
          roughly <strong>80 million adults worldwide have a gambling disorder or problematic gambling</strong>, and that
          disorder affects about <strong>8.9% of adults who bet on sports</strong> (and 16.3% of adolescents who do). As the
          Commission put it, anyone with a phone now carries “essentially a casino in their pocket, 24 hours a
          day.”${cite("lancet")}</p>
        <p>In the U.S., the National Council on Problem Gambling estimates about <strong>2.5 million adults</strong> likely
          have a gambling disorder, with 5–8 million more showing problematic behavior; in 2024, <strong>8% of adults
          (nearly 20 million people)</strong> reported a problematic gambling indicator “many times” in the past year.
          The risk skews sharply young and male — <strong>15% of 18–34-year-olds</strong> met at least one problem-play
          criterion, versus 2% of those 55 and older.${cite("ncpg")}</p>
        <p>The consequences run deeper than money. Among young adults in Great Britain, problem gamblers were many
          times more likely to have attempted suicide in the past year — an adjusted odds ratio of about
          <strong>9.0 for young men</strong>.${cite("suicide")} And after a state legalizes sports betting, research finds
          the spike in <strong>domestic violence</strong> that follows an unexpected home-team loss grows larger — the
          proposed mechanism being that betting losses pile onto the emotional blow.${cite("ipv")} Why does a losing
          bet feel so winnable in the first place? Psychology has a robust answer: an <strong>illusion of control</strong>
          — the false belief that study or skill can tame an outcome you don’t control — is consistently linked to
          disordered gambling.${cite("cog")}</p>
        <p class="pp-note"><b>Caveat:</b> the suicide figure comes from a cross-sectional survey, so it shows a strong
          association, not proof of cause, and the domestic-violence study is a working paper. We flag these
          honestly — but the direction of the evidence is consistent and serious.</p>
      </div>

      <div class="pp-section">
        <h3>5. The apps are built to exploit you</h3>
        <p>If the math and the harm aren’t enough, consider how the products are designed. This is the part that
          made us want to build an alternative.</p>
        <ul>
          <li><strong>VIP “hosts” groom the biggest losers.</strong> Sportsbooks assign personal hosts to their
            highest-spending customers, “lavishing them with trips, event tickets and promotional offers” to keep
            them betting.${cite("wapo")} Leaked job ads told hosts to “re-engage inactive users,” and a UK regulator
            found that in one case <strong>VIPs supplied 83% of an operator’s deposits</strong>.${cite("guardian")}</li>
          <li><strong>Winners get banned; losers get courted.</strong> Operators openly restrict or limit customers who
            win too consistently — one compliance director defended it on the record — while showering losing
            customers with bonuses.${cite("espnlimit", "wsjlimit")} You are allowed to play only as long as you lose.</li>
          <li><strong>Notifications push you to bet.</strong> A study of sportsbook apps found <strong>93% of their push
            notifications were advertising, and 62% were “bet pushes”</strong> urging an immediate wager — a relentless
            nudge to gamble more.${cite("ncl")}</li>
          <li><strong>Dark patterns and “free bets.”</strong> Apps use one-tap deposits, constant re-bet prompts, and
            “limited-time” free-bet offers — sometimes aimed at lapsed users who may be trying to quit. “Free”
            bonuses come with playthrough requirements designed to keep your money cycling in play.${cite("sciam")}</li>
          <li><strong>Saturation aimed at young men.</strong> Advertising is enormous and pointed at the most vulnerable
            demographic — the top books spent tens of millions on TV ads in a single NFL season.${cite("mktbrew", "nyt")}</li>
          <li><strong>Integrity is cracking, too.</strong> The flood of prop bets has been accompanied by federal
            gambling cases in the NBA and MLB in 2025 — allegations (not yet proven) that insiders manipulated
            specific plays so associates could win bets.${cite("integrity")}</li>
        </ul>
      </div>

      <div class="pp-section">
        <h3>6. Our answer</h3>
        <p>Here is the thing: the part of betting that is genuinely fun — reading a matchup, forming an opinion,
          watching it play out, finding out whether you were right — is not the part that ruins lives. The harm is
          almost entirely <strong>financial</strong>, and it is driven by distorted beliefs about control over money you
          can’t afford to lose.${cite("cog")}</p>
        <p>So we removed the money. This app uses <strong>real, live prediction-market odds</strong> but
          <strong>only fake currency</strong>. You get the thrill, the competition, and a real scoreboard of how good your
          forecasts actually are — with <strong>zero financial risk</strong>. We don’t take deposits, we can’t profit from
          your losses, there are no VIP hosts, no “bet now” notifications engineered to make you chase, and nobody
          gets banned for being good. Instead of measuring how much you wagered, we measure how <em>accurate</em> you
          are — turning a rigged game into a skill you can practice safely.</p>
        <p>If you want the rush of being right about a game, you should be able to have it without a sportsbook
          quietly engineering your bankruptcy. That’s the whole point of this place.</p>
      </div>

      <div class="pp-refs">
        <h3>Works cited</h3>
        <ol>
          ${REFS.map((r) => `<li id="pp-ref-${REF_INDEX[r.id]}">${r.cite}<br>
            <a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.url}</a></li>`).join("")}
        </ol>
        <p class="pp-ref-src" style="margin-top:14px">Sources were fact-checked against the original documents; a few
          widely-repeated but poorly-sourced statistics were deliberately left out. Where a finding rests on a
          working paper or a survey association rather than a settled, peer-reviewed result, we say so above.
          This page is educational, not financial or medical advice.</p>
      </div>

      <div class="pp-foot">
        If gambling is affecting you or someone you know, help is free and confidential. In the U.S., call or text
        the National Problem Gambling Helpline at <strong>1-800-GAMBLER</strong>, or visit
        <a href="https://www.ncpgambling.org/help-treatment/" target="_blank" rel="noopener noreferrer">ncpgambling.org</a>.
      </div>`;
  }

  // ---- the page -------------------------------------------------------------
  NRB.views.purpose = {
    async mount(container) {
      container.innerHTML = `
        <div class="pp-page">
          <div class="pp-hero">
            <div class="pp-kicker">Our Purpose</div>
            <h1>The thrill of betting, without the part that ruins lives.</h1>
            <p class="pp-lede">This is a betting app with <strong>real live odds</strong> and <strong>fake money</strong>.
              That’s a deliberate choice, not a limitation — because the evidence on real-money sports betting is
              genuinely alarming, and we wanted to keep everything fun about it while removing the one thing that
              wrecks people: the money.</p>
          </div>

          <div class="pp-creator">
            <h2>A note from the creator</h2>
            <p>I love sports and I love the game-within-the-game of predicting them. But the more I looked into
              modern sports betting, the more I realized the whole system is quietly designed to take as much from
              you as it can — and the data on what it’s doing to people is worse than I expected.</p>
            <p>So I built this: a place to get the exact same rush — live odds, real stakes on the line in points,
              a leaderboard, the satisfaction of being right — with none of your actual money at risk. No deposits,
              no way for us to profit when you lose, no tricks to keep you hooked. Just a fun way to find out if
              you’re actually any good at calling games. The research below is why.</p>
          </div>

          <div class="pp-summary">
            <h2>The short version</h2>
            <p>Real-money sports betting is, by design, a game you lose over time — and it’s doing measurable damage.
              Here’s what the evidence shows, in three numbers:</p>

            <div class="pp-stats">
              <div class="pp-stat">
                <div class="pp-stat-num neg">$13.7B</div>
                <div class="pp-stat-lbl">lost by Americans to legal sportsbooks in 2024 alone${cite("aga2024")}</div>
              </div>
              <div class="pp-stat">
                <div class="pp-stat-num neg">~79%</div>
                <div class="pp-stat-lbl">of sports-betting losses come from just the heaviest 10% of bettors${cite("norway")}</div>
              </div>
              <div class="pp-stat">
                <div class="pp-stat-num neg">≈$1</div>
                <div class="pp-stat-lbl">less saved or invested for roughly every $1 bet${cite("nber")}</div>
              </div>
            </div>

            <ul class="pp-points">
              <li><strong>The math is rigged by design.</strong> A normal bet needs you to win ~52.4% just to break
                even, and the house keeps ~9% of everything wagered — more on the parlays they push hardest.${cite("foxvig", "aga2024", "njdge")}</li>
              <li><strong>It causes real financial harm.</strong> Legalizing mobile betting has been shown to raise
                bankruptcies, debt, and overdrafts and to lower credit scores and savings.${cite("nber", "hollenbeck")}</li>
              <li><strong>A vulnerable few pay for it all.</strong> The model depends on heavy losers who can’t walk
                away — disproportionately young men and lower-income users.${cite("norway", "ncpg")}</li>
              <li><strong>The human cost is severe.</strong> ~80 million people worldwide have a gambling disorder; it’s
                strongly linked to debt, depression, and suicide.${cite("lancet", "suicide")}</li>
              <li><strong>The apps are built to exploit you.</strong> VIP “hosts” groom big losers, winning bettors get
                limited or banned, and notifications relentlessly push you to bet.${cite("wapo", "espnlimit", "ncl")}</li>
              <li><strong>Our model keeps the fun, drops the harm.</strong> Real odds, fake money, and a scoreboard for
                how accurate you are — not how much you lost.</li>
            </ul>
          </div>

          <div class="pp-more-wrap">
            <button class="pp-more" id="pp-more"><span id="pp-more-txt">Read the full paper &amp; sources</span> <span class="pp-chev">▼</span></button>
          </div>

          <div class="pp-full" id="pp-full">${fullPaper()}</div>
        </div>`;

      // expand / collapse the full paper
      const btn = container.querySelector("#pp-more");
      const full = container.querySelector("#pp-full");
      const txt = container.querySelector("#pp-more-txt");
      if (btn && full) {
        btn.addEventListener("click", () => {
          const open = full.classList.toggle("show");
          btn.classList.toggle("open", open);
          if (txt) txt.textContent = open ? "Hide the full paper" : "Read the full paper & sources";
          if (open) full.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }

      // inline [n] citations jump to (and flash) the matching reference
      container.addEventListener("click", (e) => {
        const link = e.target.closest(".pp-ref-link");
        if (!link) return;
        e.preventDefault();
        if (full && !full.classList.contains("show") && btn) btn.click();
        const n = link.getAttribute("data-ref");
        const li = container.querySelector("#pp-ref-" + n);
        if (li) {
          li.scrollIntoView({ behavior: "smooth", block: "center" });
          li.classList.remove("flash");
          void li.offsetWidth;       // restart the flash animation
          li.classList.add("flash");
        }
      });
    },
  };
})();
