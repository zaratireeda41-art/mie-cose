/* Mie Cose — generatore combinatorio di frasi motivazionali (lessico v1). */
(function (root) {
  "use strict";

  const VERSION = 1;
  const SUBJ = [
    {t:"il tuo impegno",n:"s",th:"vita"},
    {t:"la tua costanza",n:"s",th:"vita"},
    {t:"il tuo coraggio",n:"s",th:"vita"},
    {t:"la tua cura",n:"s",th:"vita"},
    {t:"la tua pazienza",n:"s",th:"vita"},
    {t:"il tuo carattere",n:"s",th:"vita"},
    {t:"la tua presenza",n:"s",th:"vita"},
    {t:"il tuo ritmo",n:"s",th:"vita"},
    {t:"la tua determinazione",n:"s",th:"vita"},
    {t:"il tuo equilibrio",n:"s",th:"vita"},
    {t:"la tua fermezza",n:"s",th:"vita"},
    {t:"il tuo slancio",n:"s",th:"vita"},
    {t:"la tua attenzione",n:"s",th:"vita"},
    {t:"il tuo cammino",n:"s",th:"vita"},
    {t:"la tua chiarezza",n:"s",th:"vita"},
    {t:"il tuo cuore",n:"s",th:"vita"},
    {t:"la tua mente",n:"s",th:"vita"},
    {t:"la tua meraviglia",n:"s",th:"vita"},
    {t:"il tuo silenzio fertile",n:"s",th:"vita"},
    {t:"la tua direzione",n:"s",th:"vita"},
    {t:"il tuo oggi",n:"s",th:"vita"},
    {t:"la tua routine",n:"s",th:"vita"},
    {t:"il tuo avanzamento",n:"s",th:"vita"},
    {t:"la tua tenacia",n:"s",th:"vita"},
    {t:"la tua curiosità",n:"s",th:"vita"},
    {t:"il tuo ingegno",n:"s",th:"vita"},
    {t:"la tua vocazione",n:"s",th:"vita"},
    {t:"il tuo mestiere",n:"s",th:"vita"},
    {t:"la tua disciplina",n:"s",th:"vita"},
    {t:"il tuo metodo",n:"s",th:"vita"},
    {t:"i tuoi passi",n:"p",th:"vita"},
    {t:"le tue scelte",n:"p",th:"vita"},
    {t:"i tuoi giorni",n:"p",th:"vita"},
    {t:"le tue energie",n:"p",th:"vita"},
    {t:"i tuoi sforzi",n:"p",th:"vita"},
    {t:"le tue abitudini",n:"p",th:"vita"},
    {t:"i tuoi progressi",n:"p",th:"vita"},
    {t:"le tue intuizioni",n:"p",th:"vita"},
    {t:"i tuoi tentativi",n:"p",th:"vita"},
    {t:"le tue pause",n:"p",th:"vita"},
    {t:"il tuo studio",n:"s",th:"legge"},
    {t:"la tua preparazione",n:"s",th:"legge"},
    {t:"il tuo ragionamento",n:"s",th:"legge"},
    {t:"la tua tesi interiore",n:"s",th:"legge"},
    {t:"il tuo diritto di provare",n:"s",th:"legge"},
    {t:"la tua lettura attenta",n:"s",th:"legge"},
    {t:"il tuo dominio della materia",n:"s",th:"legge"},
    {t:"la tua memoria attiva",n:"s",th:"legge"},
    {t:"il tuo appello interiore",n:"s",th:"legge"},
    {t:"la tua pratica giuridica",n:"s",th:"legge"},
    {t:"i tuoi appunti",n:"p",th:"legge"},
    {t:"le tue letture",n:"p",th:"legge"},
    {t:"i tuoi casi",n:"p",th:"legge"},
    {t:"le tue ripetizioni",n:"p",th:"legge"},
    {t:"i tuoi schemi",n:"p",th:"legge"},
    {t:"le tue sentenze preferite",n:"p",th:"legge"},
    {t:"il tuo lavoro",n:"s",th:"lavoro"},
    {t:"la tua professionalità",n:"s",th:"lavoro"},
    {t:"il tuo ascolto del cliente",n:"s",th:"lavoro"},
    {t:"la tua parola data",n:"s",th:"lavoro"},
    {t:"il tuo occhio per gli spazi",n:"s",th:"lavoro"},
    {t:"la tua affidabilità",n:"s",th:"lavoro"},
    {t:"il tuo piglio",n:"s",th:"lavoro"},
    {t:"la tua rete di fiducia",n:"s",th:"lavoro"},
    {t:"i tuoi incarichi",n:"p",th:"lavoro"},
    {t:"le tue visite",n:"p",th:"lavoro"},
    {t:"i tuoi appuntamenti",n:"p",th:"lavoro"},
    {t:"le tue trattative",n:"p",th:"lavoro"},
    {t:"i tuoi preventivi",n:"p",th:"lavoro"},
    {t:"le tue giornate in campo",n:"p",th:"lavoro"},
    {t:"la tua scrittura",n:"s",th:"scrittura"},
    {t:"la tua voce",n:"s",th:"scrittura"},
    {t:"la tua firma",n:"s",th:"scrittura"},
    {t:"il tuo stile",n:"s",th:"scrittura"},
    {t:"la tua pagina bianca",n:"s",th:"scrittura"},
    {t:"il tuo orecchio per le parole",n:"s",th:"scrittura"},
    {t:"le tue pagine",n:"p",th:"scrittura"},
    {t:"le tue parole",n:"p",th:"scrittura"},
    {t:"i tuoi bozzetti",n:"p",th:"scrittura"},
    {t:"le tue revisioni",n:"p",th:"scrittura"},
    {t:"i tuoi titoli",n:"p",th:"scrittura"},
    {t:"le tue frasi vere",n:"p",th:"scrittura"},
    {t:"il tuo progetto",n:"s",th:"robotica"},
    {t:"la tua precisa pazienza tecnica",n:"s",th:"robotica"},
    {t:"il tuo braccio in costruzione",n:"s",th:"robotica"},
    {t:"la tua idea meccanica",n:"s",th:"robotica"},
    {t:"il tuo cantiere creativo",n:"s",th:"robotica"},
    {t:"la tua calibrazione",n:"s",th:"robotica"},
    {t:"i tuoi prototipi",n:"p",th:"robotica"},
    {t:"le tue misure",n:"p",th:"robotica"},
    {t:"i tuoi pezzi",n:"p",th:"robotica"},
    {t:"le tue prove",n:"p",th:"robotica"},
    {t:"i tuoi schemi elettrici",n:"p",th:"robotica"},
    {t:"le tue articolazioni",n:"p",th:"robotica"}
  ];
  const VERB = [
    {s:"costruisce",p:"costruiscono"},
    {s:"rafforza",p:"rafforzano"},
    {s:"illumina",p:"illuminano"},
    {s:"guida",p:"guidano"},
    {s:"sostiene",p:"sostengono"},
    {s:"nutre",p:"nutrono"},
    {s:"apre",p:"aprono"},
    {s:"protegge",p:"proteggono"},
    {s:"accompagna",p:"accompagnano"},
    {s:"ispira",p:"ispirano"},
    {s:"solleva",p:"sollevano"},
    {s:"delinea",p:"delineano"},
    {s:"affina",p:"affinano"},
    {s:"rinnova",p:"rinnovano"},
    {s:"prepara",p:"preparano"},
    {s:"onora",p:"onorano"},
    {s:"accende",p:"accendono"},
    {s:"coltiva",p:"coltivano"},
    {s:"spinge",p:"spingono"},
    {s:"porta",p:"portano"},
    {s:"avvicina",p:"avvicinano"},
    {s:"plasma",p:"plasmano"},
    {s:"forma",p:"formano"},
    {s:"consolida",p:"consolidano"},
    {s:"chiarisce",p:"chiariscono"},
    {s:"ordina",p:"ordinano"},
    {s:"misura",p:"misurano"},
    {s:"rilancia",p:"rilanciano"},
    {s:"completa",p:"completano"},
    {s:"precisa",p:"precisano"},
    {s:"innalza",p:"innalzano"},
    {s:"radica",p:"radicano"},
    {s:"stabilisce",p:"stabiliscono"},
    {s:"conferma",p:"confermano"},
    {s:"allarga",p:"allargano"},
    {s:"approfondisce",p:"approfondiscono"},
    {s:"semplifica",p:"semplificano"},
    {s:"armonizza",p:"armonizzano"},
    {s:"orienta",p:"orientano"},
    {s:"muove",p:"muovono"},
    {s:"sveglia",p:"svegliano"},
    {s:"riaccende",p:"riaccendono"},
    {s:"cura",p:"curano"},
    {s:"difende",p:"difendono"},
    {s:"rispetta",p:"rispettano"},
    {s:"valorizza",p:"valorizzano"},
    {s:"traduce",p:"traducono"},
    {s:"raccoglie",p:"raccolgono"},
    {s:"unisce",p:"uniscono"},
    {s:"scolpisce",p:"scolpiscono"},
    {s:"sostenta",p:"sostentano"},
    {s:"alimenta",p:"alimentano"},
    {s:"rialza",p:"rialzano"},
    {s:"ricompone",p:"ricompongono"},
    {s:"promuove",p:"promuovono"},
    {s:"favorisce",p:"favoriscono"},
    {s:"genera",p:"generano"},
    {s:"produce",p:"producono"},
    {s:"sviluppa",p:"sviluppano"},
    {s:"matura",p:"maturano"},
    {s:"raffina",p:"raffinano"},
    {s:"guarisce",p:"guariscono"},
    {s:"calma",p:"calmano"},
    {s:"stabilizza",p:"stabilizzano"},
    {s:"centra",p:"centrano"},
    {s:"bilancia",p:"bilanciano"},
    {s:"anticipa",p:"anticipano"},
    {s:"prevede",p:"prevedono"},
    {s:"organizza",p:"organizzano"},
    {s:"sistema",p:"sistemano"},
    {s:"allinea",p:"allineano"},
    {s:"sblocca",p:"sbloccano"},
    {s:"libera",p:"liberano"},
    {s:"rassicura",p:"rassicurano"},
    {s:"incoraggia",p:"incoraggiano"},
    {s:"motiva",p:"motivano"},
    {s:"sprona",p:"spronano"},
    {s:"eleva",p:"elevano"},
    {s:"arricchisce",p:"arricchiscono"},
    {s:"amplia",p:"ampliano"},
    {s:"estende",p:"estendono"},
    {s:"raduna",p:"radunano"},
    {s:"connette",p:"connettono"},
    {s:"collega",p:"collegano"},
    {s:"integra",p:"integrano"},
    {s:"sostanzia",p:"sostanziano"},
    {s:"realizza",p:"realizzano"},
    {s:"compie",p:"compiono"},
    {s:"porta avanti",p:"portano avanti"},
    {s:"fa crescere",p:"fanno crescere"},
    {s:"rinvigorisce",p:"rinvigoriscono"},
    {s:"tempra",p:"temprano"},
    {s:"afferma",p:"affermano"},
    {s:"disegna",p:"disegnano"},
    {s:"traccia",p:"tracciano"},
    {s:"svela",p:"svelano"},
    {s:"mostra",p:"mostrano"},
    {s:"rivela",p:"rivelano"},
    {s:"custodisce",p:"custodiscono"},
    {s:"conserva",p:"conservano"},
    {s:"riordina",p:"riordinano"},
    {s:"mette a fuoco",p:"mettono a fuoco"},
    {s:"sostiene con forza",p:"sostengono con forza"}
  ];
  const OBJ = [
    "il prossimo passo",
    "la strada che hai scelto",
    "il lavoro di oggi",
    "le fondamenta del futuro",
    "una direzione più chiara",
    "ciò che stai costruendo",
    "la tua migliore energia",
    "un progresso reale",
    "la meta che meriti",
    "il senso di ogni sforzo",
    "nuove possibilità",
    "il coraggio di continuare",
    "un equilibrio nuovo",
    "la pratica di ogni giorno",
    "il ritmo che ti appartiene",
    "una calma più solida",
    "il frutto della tua attesa",
    "la qualità del tuo gesto",
    "un orizzonte più ampio",
    "la costanza dei piccoli atti",
    "il centro di ciò che conta",
    "una fiducia più salda",
    "il meglio di questa giornata",
    "la spiegazione che cercavi",
    "un ordine gentile nelle cose",
    "la misura giusta del fare",
    "il valore del tuo tempo",
    "una presenza più intenzionale",
    "il ponte verso domani",
    "la lucidità che serve adesso",
    "un passo più consapevole",
    "la bellezza del lavoro fatto bene",
    "il silenzio in cui nasce l'idea",
    "una disciplina leggera",
    "il tuo modo di stare al mondo",
    "la tenacia che già hai",
    "un avanzamento quieto e vero",
    "la chiarezza del da farsi",
    "il rispetto per i tuoi limiti",
    "una forza senza fretta",
    "il tesoro della tua esperienza",
    "la lezione nascosta nel difficile",
    "un inizio sempre disponibile",
    "la tua voce più onesta",
    "il campo in cui puoi crescere",
    "una sintesi più nitida",
    "il coraggio delle cose semplici",
    "la pazienza che costruisce risultati",
    "un metodo che ti somiglia",
    "la cura dei dettagli",
    "il fuoco lento della competenza",
    "una visione che regge",
    "il resto della strada",
    "la tua parte migliore",
    "un alleggerimento utile",
    "la direzione già scelta",
    "il lavoro invisibile di oggi",
    "una costanza che si vede",
    "il nodo che stai sciogliendo",
    "la tua libertà di riprovare",
    "un respiro più ampio",
    "la precisione che ti distingueva",
    "il senso pratico delle tue idee",
    "una luce sul prossimo compito",
    "il tuo standard personale",
    "la tua parola più chiara",
    "un impegno sostenibile",
    "la forma giusta del progetto",
    "il dettaglio che cambia tutto",
    "una traiettoria più pulita",
    "il meritato riposo dopo lo sforzo",
    "la tua capacità di ricominciare",
    "un sapere che diventa gesto",
    "la solidità delle tue basi",
    "il filo che unisce i tuoi giorni",
    "una risposta più matura",
    "il tuo spazio di concentrazione",
    "la logica che stai affinando",
    "un criterio più sicuro",
    "la tua autorità silenziosa",
    "il lavoro che merita tempo",
    "una fine elegante della giornata",
    "il rispetto per ciò che inizi",
    "la tua intelligenza pratica",
    "un coraggio quotidiano",
    "la tua firma sui gesti piccoli",
    "il terreno fertile delle abitudini",
    "una speranza con i piedi per terra",
    "il tuo passo naturale",
    "la tua arte di mettere ordine"
  ];
  const CLOSE_ADV = [
    "un passo alla volta",
    "con pazienza e chiarezza",
    "senza bisogno di correre",
    "anche nei giorni più pieni",
    "con la calma che serve",
    "con metodo e cuore",
    "verso un risultato solido",
    "con rispetto per i tuoi tempi",
    "senza perdere la direzione",
    "con una dolce determinazione",
    "anche quando la strada è lunga",
    "nel modo che ti è proprio",
    "con la precisione che meriti",
    "senza chiedere il permesso al dubbio",
    "con gratitudine per ciò che già sei",
    "oggi, e poi ancora domani",
    "con leggerezza e rigore",
    "senza sprecare il tuo fuoco",
    "nel silenzio del fare",
    "con fiducia misurata",
    "anche in mezzo alle interruzioni",
    "con la lentezza intelligente",
    "verso una forma più vera",
    "con cura artigianale",
    "senza confrontarti con nessuno",
    "nel tempo giusto, non in quello altrui",
    "con onestà e coraggio",
    "anche se nessuno sta guardando",
    "con la fermezza di chi sa aspettare",
    "senza rinunciare alla bellezza",
    "nel segno della continuità",
    "con un sorriso alle difficoltà",
    "verso ciò che resta",
    "con la mente chiara e le mani pronte",
    "senza drammi inutili",
    "nel rispetto del tuo corpo e della tua mente",
    "con la lealtà che hai verso te stesso",
    "anche quando il risultato è lontano",
    "con costanza quasi invisibile",
    "verso una giornata ben chiusa",
    "con l'eleganza della semplicità",
    "senza perdere il senso del gioco",
    "nel piccolo cerchio di ciò che puoi fare ora",
    "con una disciplina amica",
    "anche nel frammento di un'ora",
    "con la stessa cura di un artigiano",
    "verso un tu più riconoscente",
    "senza fretta e senza indugio",
    "nel solco già aperto",
    "con attenzione piena",
    "anche questa volta",
    "con un respiro prima di ogni scelta",
    "verso una pratica che dura",
    "senza tradire ciò che ami",
    "nel concreto, dove le cose succedono",
    "con una voce bassa e ferma",
    "anche nei compiti minimi",
    "con la pazienza di chi costruisce per restare",
    "verso un ordine che ti fa bene",
    "senza dimenticare di fermarti",
    "nel coraggio quotidiano",
    "con tenacia lieve",
    "anche se oggi basta poco",
    "con piena presenza"
  ];
  const CLOSE_CL = [
    "tutto trova un suo posto",
    "il resto arriva da sé",
    "vai più lontano di quanto credi",
    "la giornata prende una forma migliore",
    "la fatica diventa un alleato",
    "nasce uno spazio più ampio",
    "il dubbio perde volume",
    "resta ciò che conta",
    "il prossimo ostacolo è già più piccolo",
    "ti riconosci un po' di più",
    "il lavoro acquista senso",
    "la mente si fa più quieta",
    "ogni cosa torna alla sua misura",
    "si apre un varco inatteso",
    "la tua voce interiore si fa chiara",
    "il tempo smette di essere un nemico",
    "cresce una fiducia nuova",
    "il corpo ringrazia",
    "il progetto respira",
    "diventi più fedele a te stesso",
    "la strada si semplifica",
    "arriva una luce laterale",
    "il giorno merita di essere firmato",
    "scopri una riserva che non sapevi di avere",
    "le priorità si mettono in fila",
    "il rumore intorno si allontana",
    "prendi una decisione più pulita",
    "il futuro si avvicina senza urgenza",
    "una parte di te si rassicura",
    "l'insieme comincia a tenersi",
    "ritrovi il gusto del fare",
    "la disciplina diventa naturale",
    "c'è più spazio per ciò che ami",
    "il passo successivo è evidente",
    "ti senti all'altezza della tua vita",
    "la chiarezza sostituisce la fretta",
    "ogni gesto pesa nel modo giusto",
    "il coraggio diventa abitudine",
    "ti muovi con più grazia",
    "il risultato matura in silenzio",
    "una porta che credevi chiusa cede un poco",
    "torna il piacere della precisione",
    "la tua giornata ha un centro",
    "imparare diventa più leggero",
    "il merito si accumula senza ostentazione",
    "sei già più avanti di ieri",
    "la tua presenza basta",
    "il resto può aspettare"
  ];
  const FRONT = [
    "Con calma",
    "Oggi",
    "Senza fretta",
    "Con coraggio",
    "Adesso",
    "Con lucidità",
    "In silenzio",
    "Con metodo",
    "Senza drammi",
    "Con cura",
    "Stavolta",
    "Con leggerezza",
    "Nel vivo della giornata",
    "Con fermezza gentile",
    "Anche adesso",
    "Con attenzione piena",
    "A passo misurato",
    "Con gratitudine",
    "Nel concreto",
    "Con una condotta chiara",
    "Senza rincorrere nessuno",
    "Con disciplina amica",
    "In questo istante",
    "Con onestà",
    "Nel mezzo del da farsi",
    "Con un respiro ampio",
    "Senza perdere il centro",
    "Con intenzione",
    "Nel tuo tempo",
    "Con semplicità",
    "Anche in uno spazio breve",
    "Con lealtà verso te stesso",
    "Nella quiete possibile",
    "Con un piglio sicuro",
    "Senza alzare la voce",
    "Con precisione",
    "Nel punto in cui sei",
    "Con pazienza attiva",
    "Senza chiedere troppo al futuro",
    "Con un sorriso saldo",
    "Nella pratica di oggi",
    "Con rispetto",
    "Senza spezzare il ritmo",
    "Con una mente aperta",
    "Nel segno della continuità",
    "Con una spinta lieve",
    "Senza confondere urgenza e importanza",
    "Con la schiena dritta",
    "Nel tuo modo",
    "Con piena presenza",
    "Anche questa mattina",
    "Con un proposito chiaro"
  ];
  const IMP = [
    "Porta avanti",
    "Coltiva",
    "Difendi",
    "Affina",
    "Ascolta",
    "Costruisci",
    "Onora",
    "Attraversa",
    "Ricomponi",
    "Riordina",
    "Misura",
    "Collega",
    "Scegli",
    "Proteggi",
    "Nutri",
    "Rilancia",
    "Completa",
    "Rileggi",
    "Annota",
    "Osserva",
    "Consolida",
    "Precisa",
    "Chiarisci",
    "Sostieni",
    "Accogli",
    "Prepara",
    "Pianifica",
    "Custodisci",
    "Metti a fuoco",
    "Tieni stretto",
    "Sistema con cura",
    "Prendi sul serio",
    "Riconosci",
    "Prosegui",
    "Guida",
    "Rispetta",
    "Valorizza",
    "Organizza",
    "Illumina",
    "Rinnova",
    "Completa con calma",
    "Tieni a mente",
    "Salvaguarda",
    "Perfeziona",
    "Allinea",
    "Sblocca",
    "Libera",
    "Incoraggia",
    "Eleva",
    "Arricchisci",
    "Integra",
    "Realizza",
    "Tempra",
    "Traccia",
    "Svela",
    "Mostra",
    "Conserva",
    "Riaccendi",
    "Bilancia",
    "Centra",
    "Anticipa",
    "Stabilisci",
    "Conferma",
    "Semplifica",
    "Armonizza",
    "Orienta"
  ];
  const OTU = [
    "il tuo studio",
    "la tua pratica quotidiana",
    "ogni riga che scrivi",
    "il progetto del braccio",
    "le trattative di oggi",
    "la lezione che stai preparando",
    "ciò che hai iniziato",
    "il tuo metodo",
    "la tua parola",
    "il tuo impegno silenzioso",
    "la tua routine del mattino",
    "ogni appuntamento della giornata",
    "il fascicolo che hai sul tavolo",
    "la visita che ti aspetta",
    "il testo da limare",
    "la calibrazione del movimento",
    "i tuoi appunti di diritto",
    "la bozza ancora calda",
    "il prossimo incarico",
    "la tua lista di oggi",
    "il pezzo che manca al progetto",
    "la tua ora di concentrazione",
    "il capitolo da rileggere",
    "la chiamata che stavi rimandando",
    "il tuo spazio di lavoro",
    "la misura già presa",
    "il disegno del meccanismo",
    "la formula che stai chiarendo",
    "il tuo impegno con te stesso",
    "la pagina che merita una firma",
    "il cliente che si fida di te",
    "la sentenza da comprendere fino in fondo",
    "il piccolo progresso tecnico",
    "la tua pausa meritatamente breve",
    "il nodo della trattativa",
    "la struttura del saggio",
    "il tuo piano di studio",
    "la prova sul tavolo",
    "il gesto ripetuto con cura",
    "la tua voce nella scrittura",
    "il diritto che stai assimilando",
    "la pianta dell'immobile",
    "il servo da montare",
    "la scaletta dell'articolo",
    "il tuo ripasso serale",
    "la relazione da consegnare",
    "il codice che stai scrivendo",
    "la tua disciplina di oggi",
    "il particolare che hai notato",
    "la domanda ancora aperta",
    "il tuo taccuino",
    "la montatura del braccio",
    "il contratto da rileggere",
    "la tua sessione di studio",
    "il preventivo onesto",
    "la precedente versione del testo",
    "il giunto che deve muoversi meglio",
    "la tua concentrazione",
    "il programma d'esame",
    "la giornata che hai davanti",
    "il lavoro già avviato",
    "la tua curiosità tecnica",
    "il ragionamento giuridico",
    "la trattativa in corso",
    "il capoverso da alleggerire",
    "la tua prova di movimento",
    "il compito più ingrato",
    "la tua priorità vera",
    "il particolare estetico del pezzo",
    "la nota a margine",
    "il tuo calendario",
    "la questione di principio"
  ];
  const CTX = [
    {t:"nello studio",th:"legge"},
    {t:"nel diritto",th:"legge"},
    {t:"tra le pagine del codice",th:"legge"},
    {t:"nella preparazione dell'esame",th:"legge"},
    {t:"nel ripasso sereno",th:"legge"},
    {t:"nella pratica dei casi",th:"legge"},
    {t:"sul banco dei tuoi appunti",th:"legge"},
    {t:"nella lettura lenta di un comma",th:"legge"},
    {t:"nel ragionamento giuridico",th:"legge"},
    {t:"davanti al programma d'appello",th:"legge"},
    {t:"nel lavoro di ogni giorno",th:"lavoro"},
    {t:"in trattativa",th:"lavoro"},
    {t:"nella visita a un immobile",th:"lavoro"},
    {t:"nell'ascolto del cliente",th:"lavoro"},
    {t:"tra un appuntamento e l'altro",th:"lavoro"},
    {t:"nella parola data",th:"lavoro"},
    {t:"sul campo, dove le case parlano",th:"lavoro"},
    {t:"nella preparazione di un preventivo",th:"lavoro"},
    {t:"nel mestiere che hai scelto",th:"lavoro"},
    {t:"durante una giornata piena",th:"lavoro"},
    {t:"nella scrittura",th:"scrittura"},
    {t:"davanti alla pagina bianca",th:"scrittura"},
    {t:"tra una riga e la successiva",th:"scrittura"},
    {t:"nella revisione paziente",th:"scrittura"},
    {t:"nel taglio di un aggettivo di troppo",th:"scrittura"},
    {t:"nella voce che stai cercando",th:"scrittura"},
    {t:"sul taccuino aperto",th:"scrittura"},
    {t:"nella riscrittura della bozza",th:"scrittura"},
    {t:"nel silenzio in cui si scrive",th:"scrittura"},
    {t:"dopo la prima stesura",th:"scrittura"},
    {t:"nel cantiere del braccio",th:"robotica"},
    {t:"tra viti, misure e prove",th:"robotica"},
    {t:"nella calibrazione di un giunto",th:"robotica"},
    {t:"sul banco di montaggio",th:"robotica"},
    {t:"nel disegno di un movimento",th:"robotica"},
    {t:"durante un test del meccanismo",th:"robotica"},
    {t:"nella pazienza dell'assemblaggio",th:"robotica"},
    {t:"davanti a un pezzo che non entra",th:"robotica"},
    {t:"nel progetto che cresce a piccoli scatti",th:"robotica"},
    {t:"quando il servo risponde al comando",th:"robotica"},
    {t:"nella vita di tutti i giorni",th:"vita"},
    {t:"nel piccolo cerchio delle tue ore",th:"vita"},
    {t:"nella quiete possibile",th:"vita"},
    {t:"in mezzo alle cose da fare",th:"vita"},
    {t:"nel tuo ritmo naturale",th:"vita"},
    {t:"quando la giornata sembra troppo piena",th:"vita"},
    {t:"nel rispetto dei tuoi limiti",th:"vita"},
    {t:"nella cura di ciò che è vicino",th:"vita"},
    {t:"al momento di ricominciare",th:"vita"},
    {t:"nella semplicità di un gesto vero",th:"vita"}
  ];
  const TEMPLATES = [
    {id:"svo_a",slots:"SVOA",size:55768320},
    {id:"svo_plain",slots:"SVO",size:871380},
    {id:"front_svo",slots:"FSVO",size:45311760},
    {id:"front_svo_a",slots:"FSVOA",size:2899952640},
    {id:"oggi_svo_a",slots:"SVOA",size:55768320},
    {id:"svo_colon_a",slots:"SVOA",size:55768320},
    {id:"quando_svo_c",slots:"SVOC",size:41826240},
    {id:"anche_oggi_svo",slots:"SVO",size:871380},
    {id:"ricorda_svo",slots:"SVO",size:871380},
    {id:"front_ricorda_svo",slots:"FSVO",size:45311760},
    {id:"s_non_si_ferma",slots:"SVOA",size:55768320},
    {id:"ctx_svo",slots:"XSVO",size:43569000},
    {id:"ctx_svo_a",slots:"XSVOA",size:2788416000},
    {id:"e_ctx_che",slots:"XSVO",size:43569000},
    {id:"imp_t_a",slots:"ITA",size:304128},
    {id:"imp_t_colon_a",slots:"ITA",size:304128},
    {id:"front_imp_t",slots:"FIT",size:247104},
    {id:"imp_t_e_lascia",slots:"ITSVO",size:4140797760},
    {id:"imp_t_colon_svo_a",slots:"ITSVOA",size:265011056640},
    {id:"là_dove_svo_c",slots:"SVOC",size:41826240},
    {id:"se_resti_fedele",slots:"ITSVO",size:4140797760},
    {id:"ogni_volta_svo_c",slots:"SVOC",size:41826240},
    {id:"non_manca_altro",slots:"FSVO",size:45311760},
    {id:"tu_puoi_lasciare",slots:"SVOA",size:55768320},
    {id:"mentre_svo_c",slots:"SVOC",size:41826240}
  ];
  const THEME_LABEL = {
    legge: "Studio e diritto",
    lavoro: "Lavoro e immobili",
    scrittura: "Scrittura",
    robotica: "Robotica",
    vita: "Vita"
  };

  const TOTAL = 279653710140 /* 279.653.710.140 */;
  const A = 252141364729;
  const B = 142488702727;

  function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function verbFor(subj, verb) {
    return subj.n === "s" ? verb.s : verb.p;
  }

  function decode(n, slots) {
    const p = {};
    let x = n;
    for (let i = slots.length - 1; i >= 0; i--) {
      const code = slots.charAt(i);
      const arr = code === "S" ? SUBJ : code === "V" ? VERB : code === "O" ? OBJ
        : code === "A" ? CLOSE_ADV : code === "C" ? CLOSE_CL : code === "F" ? FRONT
        : code === "I" ? IMP : code === "T" ? OTU : CTX;
      p[code] = arr[x % arr.length];
      x = Math.floor(x / arr.length);
    }
    return p;
  }

  function build(tid, p) {
    const S = p.S && p.S.t;
    const V = p.S && p.V ? verbFor(p.S, p.V) : "";
    const O = p.O;
    const A = p.A;
    const C = p.C;
    const F = p.F;
    const I = p.I;
    const T = p.T;
    const X = p.X && p.X.t;
    const lowerImp = I ? I.charAt(0).toLowerCase() + I.slice(1) : "";
    switch (tid) {
      case "svo_a": return cap(S) + " " + V + " " + O + ", " + A + ".";
      case "svo_plain": return cap(S) + " " + V + " " + O + ".";
      case "front_svo": return F + ", " + S + " " + V + " " + O + ".";
      case "front_svo_a": return F + ", " + S + " " + V + " " + O + ", " + A + ".";
      case "oggi_svo_a": return "Oggi " + S + " " + V + " " + O + ", " + A + ".";
      case "svo_colon_a": return cap(S) + " " + V + " " + O + ": " + A + ".";
      case "quando_svo_c": return "Quando " + S + " " + V + " " + O + ", " + C + ".";
      case "anche_oggi_svo": return "Anche oggi " + S + " " + V + " " + O + ".";
      case "ricorda_svo": return "Ricorda: " + S + " " + V + " " + O + ".";
      case "front_ricorda_svo": return F + ", ricorda che " + S + " " + V + " " + O + ".";
      case "s_non_si_ferma":
        return cap(S) + (p.S.n === "s" ? " non si ferma: " : " non si fermano: ") + V + " " + O + ", " + A + ".";
      case "ctx_svo": return cap(X) + ", " + S + " " + V + " " + O + ".";
      case "ctx_svo_a": return cap(X) + ", " + S + " " + V + " " + O + ", " + A + ".";
      case "e_ctx_che": return "È " + X + " che " + S + " " + V + " " + O + ".";
      case "imp_t_a": return I + " " + T + ", " + A + ".";
      case "imp_t_colon_a": return I + " " + T + ": " + A + ".";
      case "front_imp_t": return F + ", " + lowerImp + " " + T + ".";
      case "imp_t_e_lascia": return I + " " + T + " e lascia che " + S + " " + V + " " + O + ".";
      case "imp_t_colon_svo_a": return I + " " + T + ": " + S + " " + V + " " + O + ", " + A + ".";
      case "là_dove_svo_c": return "Là dove " + S + " " + V + " " + O + ", " + C + ".";
      case "se_resti_fedele": return "Resta fedele, " + lowerImp + " " + T + ": " + S + " " + V + " " + O + ".";
      case "ogni_volta_svo_c": return "Ogni volta che " + S + " " + V + " " + O + ", " + C + ".";
      case "non_manca_altro": return F + ", non manca altro: " + S + " " + V + " " + O + ".";
      case "tu_puoi_lasciare": return "Puoi lasciare che " + S + " " + V + " " + O + ", " + A + ".";
      case "mentre_svo_c": return "Mentre " + S + " " + V + " " + O + ", " + C + ".";
      default: return cap(S) + " " + V + " " + O + ".";
    }
  }

  function themeOf(tid, p, n) {
    if (p.X && p.X.th) return p.X.th;
    if (p.S && p.S.th) return p.S.th;
    const keys = ["vita", "legge", "lavoro", "scrittura", "robotica"];
    return keys[n % keys.length];
  }

  function locate(index) {
    let n = index % TOTAL;
    if (n < 0) n += TOTAL;
    for (let i = 0; i < TEMPLATES.length; i++) {
      const t = TEMPLATES[i];
      if (n < t.size) return { tid: t.id, slots: t.slots, local: n };
      n -= t.size;
    }
    return { tid: TEMPLATES[0].id, slots: TEMPLATES[0].slots, local: 0 };
  }

  function phraseAt(index) {
    let n = Number(index);
    if (!Number.isFinite(n)) n = 0;
    n = ((n % TOTAL) + TOTAL) % TOTAL;
    const loc = locate(n);
    const p = decode(loc.local, loc.slots);
    const text = build(loc.tid, p);
    const theme = themeOf(loc.tid, p, n);
    return {
      n: n,
      v: VERSION,
      text: text,
      theme: theme,
      themeLabel: THEME_LABEL[theme] || THEME_LABEL.vita,
      template: loc.tid
    };
  }

  function permuteK(k) {
    const T = BigInt(TOTAL);
    let x = BigInt(String(k).split(".")[0] || "0");
    if (x < 0n) x = -x;
    x = x % T;
    return Number((BigInt(A) * x + BigInt(B)) % T);
  }

  function streamAt(k) {
    return phraseAt(permuteK(k));
  }

  function phraseForSlot(slot) {
    // Time buckets should also be a permutation, independent from the manual stream.
    const n = permuteK((Number(slot) * 104729 + 17) % TOTAL);
    return phraseAt(n);
  }

  function formatExact(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function formatTotal() {
    return {
      exact: formatExact(TOTAL),
      human: "279,7 miliardi",
      total: TOTAL
    };
  }

  const api = {
    VERSION: VERSION,
    TOTAL: TOTAL,
    A: A,
    B: B,
    phraseAt: phraseAt,
    streamAt: streamAt,
    permuteK: permuteK,
    phraseForSlot: phraseForSlot,
    formatTotal: formatTotal,
    formatExact: formatExact,
    themeLabel: function (th) { return THEME_LABEL[th] || THEME_LABEL.vita; }
  };

  root.MiaFrasi = api;
})(window);
