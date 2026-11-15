/**
 * COLLEGE FOOTBALL'S FBS (QA pass 9 #28, 2026-10-13): the college football picker lists the Football Bowl Subdivision by default and the
 * rest of the frozen list (FCS, Division II and III, which the 10-10 copy of the league's team list also carries) only on request
 * (GET /v1/sports/teams?league=cfb&division=all). The 2026 FBS by conference membership as announced for the 2026 season (138 programs:
 * the ACC, Big Ten, Big 12, SEC, Pac-12, Mountain West, American, Conference USA, MAC, Sun Belt and the independents Notre Dame and UConn),
 * pinned by ESPN team id, the id every series uses. Check it each season; a program that moves up is added here.
 */
export const FBS_TEAM_IDS: ReadonlySet<string> = new Set([
  "2005", // Air Force
  "2006", // Akron
  "333", // Alabama
  "2026", // App State
  "12", // Arizona
  "9", // Arizona State
  "8", // Arkansas
  "2032", // Arkansas State
  "349", // Army
  "2", // Auburn
  "252", // BYU
  "2050", // Ball State
  "239", // Baylor
  "68", // Boise State
  "103", // Boston College
  "189", // Bowling Green
  "2084", // Buffalo
  "25", // California
  "2117", // Central Michigan
  "2429", // Charlotte
  "2132", // Cincinnati
  "228", // Clemson
  "324", // Coastal Carolina
  "38", // Colorado
  "36", // Colorado State
  "48", // Delaware
  "150", // Duke
  "151", // East Carolina
  "2199", // Eastern Michigan
  "57", // Florida
  "2226", // Florida Atlantic
  "2229", // Florida International
  "52", // Florida State
  "278", // Fresno State
  "61", // Georgia
  "290", // Georgia Southern
  "2247", // Georgia State
  "59", // Georgia Tech
  "62", // Hawai'i
  "248", // Houston
  "356", // Illinois
  "84", // Indiana
  "2294", // Iowa
  "66", // Iowa State
  "55", // Jacksonville State
  "256", // James Madison
  "2305", // Kansas
  "2306", // Kansas State
  "338", // Kennesaw State
  "2309", // Kent State
  "96", // Kentucky
  "99", // LSU
  "2335", // Liberty
  "309", // Louisiana
  "2348", // Louisiana Tech
  "97", // Louisville
  "276", // Marshall
  "120", // Maryland
  "113", // Massachusetts
  "235", // Memphis
  "2390", // Miami
  "193", // Miami (OH)
  "130", // Michigan
  "127", // Michigan State
  "2393", // Middle Tennessee
  "135", // Minnesota
  "344", // Mississippi State
  "142", // Missouri
  "2623", // Missouri State
  "152", // NC State
  "2426", // Navy
  "158", // Nebraska
  "2440", // Nevada
  "167", // New Mexico
  "166", // New Mexico State
  "153", // North Carolina
  "2449", // North Dakota State
  "249", // North Texas
  "2459", // Northern Illinois
  "77", // Northwestern
  "87", // Notre Dame
  "195", // Ohio
  "194", // Ohio State
  "201", // Oklahoma
  "197", // Oklahoma State
  "295", // Old Dominion
  "145", // Ole Miss
  "2483", // Oregon
  "204", // Oregon State
  "213", // Penn State
  "221", // Pittsburgh
  "2509", // Purdue
  "242", // Rice
  "164", // Rutgers
  "2567", // SMU
  "16", // Sacramento State
  "2534", // Sam Houston
  "21", // San Diego State
  "23", // San José State
  "6", // South Alabama
  "2579", // South Carolina
  "58", // South Florida
  "2572", // Southern Miss
  "24", // Stanford
  "183", // Syracuse
  "2628", // TCU
  "218", // Temple
  "2633", // Tennessee
  "251", // Texas
  "245", // Texas A&M
  "326", // Texas State
  "2641", // Texas Tech
  "2649", // Toledo
  "2653", // Troy
  "2655", // Tulane
  "202", // Tulsa
  "5", // UAB
  "2116", // UCF
  "26", // UCLA
  "41", // UConn
  "2433", // UL Monroe
  "2439", // UNLV
  "30", // USC
  "2638", // UTEP
  "2636", // UTSA
  "254", // Utah
  "328", // Utah State
  "238", // Vanderbilt
  "258", // Virginia
  "259", // Virginia Tech
  "154", // Wake Forest
  "264", // Washington
  "265", // Washington State
  "277", // West Virginia
  "98", // Western Kentucky
  "2711", // Western Michigan
  "275", // Wisconsin
  "2751", // Wyoming
]);
