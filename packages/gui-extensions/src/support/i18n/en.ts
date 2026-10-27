export default {
  "advice.auth":
    "The API key is wrong or has expired. In Settings → Providers, disconnect this provider and connect it again with a new key.",
  "advice.auth.openrouter":
    "OpenRouter did not accept the API key. Check that the key still exists at openrouter.ai → Keys, then in Settings → Providers disconnect OpenRouter and connect it again with a new key.",
  "advice.credits":
    "The credits or usage limit have run out. Top up or raise the limit on the provider's site, and choose another model meanwhile.",
  "advice.rate":
    "Too many requests in a short time, so the provider paused them. Send again in a minute or two. Free models have daily and per-minute limits, so another model may work better.",
  "advice.network":
    "The connection dropped or the provider could not be reached. Check the internet connection and any company firewall or proxy, then send again.",
  "advice.timeout": "The answer took too long. Send again or choose a faster model.",
  "advice.server": "The provider's servers have a temporary problem. Send again shortly or choose another model.",
  "advice.content": "The provider's safety rules refused the request. Rephrase it or choose another model.",
  "advice.context":
    "The conversation and attachments are more than this model can read at once. Start a new conversation, split the files, or choose a model that reads longer text.",
  "advice.image": "This model cannot read images or PDFs. Choose a model that reads images.",
  "advice.privacy":
    "OpenRouter's privacy settings block this model. Change them at openrouter.ai → Settings → Privacy or choose another model.",
  "advice.model": "The chosen model is not available now. Choose another model from the model list.",
  "advice.unsupported": "This model does not support this feature. Choose another model.",
  "advice.output": "The model's answer came back broken. Send again or choose another model.",
  "advice.request": "The model refused the request. Send it again, and choose another model if it keeps failing.",
  "action.providers": "Open Providers",
  "action.report": "Report this error",
  "action.report.description":
    "Saves a screenshot of this window and opens a report form in the browser. Nothing is sent until you submit it.",
  "capture.saved": "Screenshot saved",
  "capture.attach":
    "Saved as {{name}} in Pictures › 자비수 오류 캡처 and copied to the clipboard. Attach it in the form's Screenshot question if you want to; it shows the conversation, so check it first. Uploading a file records your Google account's name and email.",
  "capture.folder": "Show in folder",
  "capture.close": "Close",
  "command.group": "Help",
  "command.report": "Report an error",
  "command.feedback": "Send feedback",
  "command.guide": "Jabisu guide",
  "tutorial.title": "Get started with Jabisu",
  "tutorial.intro": "Try these five and Jabisu is ready for your work.",
  "tutorial.done": "All done! See the guide to learn more.",
  "tutorial.guide": "Guide",
  "tutorial.hide": "Hide",
  "mission.folders.title": "Choose your work folders",
  "mission.folders.description":
    "Add your downloads and messenger folders as received-file folders. The work assistant section is down the Preferences page.",
  "mission.folders.action": "Open settings",
  "mission.profile.title": "Make your work profile",
  "mission.profile.description":
    "Drop your duty assignment table into the new chat, fill in your position in the brackets, and send.",
  "mission.profile.action": "Try it",
  "mission.profile.prompt":
    "Make my work profile from the attached duty assignment table. My position is (grade, extension).",
  "mission.search.title": "Find a work file",
  "mission.search.description": "Ask for files you received, by what they say as well as their names.",
  "mission.search.action": "Try it",
  "mission.search.prompt": "Show me the files I received this week.",
  "mission.docs.title": "Make an office document",
  "mission.docs.description":
    "Make a memo report, minutes or press release as a Hangul file in the official layout. Fill in the brackets in the chat that opens.",
  "mission.docs.action": "Try it",
  "mission.docs.prompt":
    "Make a draft memo report as a Hangul file. Topic: (one or two lines). Leave what you do not know as (확인 필요) and ask me.",
  "mission.law.title": "Ask about a law",
  "mission.law.setup.description":
    "First get a free 법제처 key at open.law.go.kr (register this PC's public IP) and enter it in Settings → Preferences → Law lookup.",
  "mission.law.setup.action": "Enter the key",
  "mission.law.description": "See it answer from the official text, citing the article and its effective date.",
  "mission.law.action": "Try it",
  "mission.law.prompt":
    "Show me the official text of 「보조금 관리에 관한 법률」 제26조의2 and check that the articles you cite exist.",
  "guide.title": "Jabisu guide",
  "guide.intro":
    "A short guide for your first days. To try things out, use “Get started with Jabisu” on the home screen.",
  "guide.settings": "Open settings",
  "guide.web": "View on the web",
  "guide.start.title": "Getting started",
  "guide.start.body":
    "Jabisu is an AI aide you give work to by chatting. Write what you need in the composer, in your own words.\nFirst connect an AI model in Settings → Providers (it needs an API key), then pick the model under the composer.\nA chat works in a workroom (a folder); files the AI makes are saved there unless you say otherwise.\nDrop files into the composer for the AI to read: Hangul, Word, Excel, PowerPoint and PDF.",
  "guide.work.title": "Work assistant",
  "guide.work.body":
    "Choose folders in Settings → Preferences → Work assistant. The Jabisu work folder (Documents\\자비수 업무) is always searched.\nAdd your downloads and messenger folders as received-file folders, and the folders you file work in as work storage folders.\nAsk “find the notice I received last week” and Jabisu finds it by name and by what the documents say.\nAttach your duty assignment table and ask for your work profile; every chat then knows your duties.",
  "guide.documents.title": "Making documents",
  "guide.documents.body":
    "Ask for “a Hangul report from this”, “an Excel table of this” or “five slides on this” and Jabisu makes the file.\nIf Python is needed the first time, the AI asks before installing it.\nFiles are saved in the workroom; open them from the file view beside the chat.",
  "guide.admin.title": "Office document forms",
  "guide.admin.body":
    'Say "make a result report from this", "make the minutes", "draft a press release", "write a trip report" or "sum it up as a memo report" and it makes a Hangul file in the official layout.\nIt has the title box, the □ ○ - outline, summary tables and the press release header, and it checks how dates, times and amounts are written and suggests plainer official words.\nIt never makes up figures, quotes or attendees; it leaves (확인 필요) and asks.\nSay "check how this report is written" to have a document you wrote checked.',
  "guide.law.title": "Law lookup",
  "guide.law.body":
    "Enter a 법제처 key in Settings → Preferences → Law lookup to turn it on. Get one free at open.law.go.kr by signing up and applying for the OPEN API, and register the public IP address this PC uses on the internet.\nIt answers from the official text of laws, local ordinances, administrative rules, precedents and interpretations, citing 「name」 article N with its effective date.\nIt checks the articles a report or answer cites against the official text and reports any article, paragraph or item that does not exist.\nThe words it searches for are sent to law.go.kr. Its answers are material to review; the decision stays with you.",
  "guide.jiphyeonjeon.title": "집현전 (ask your own sources)",
  "guide.jiphyeonjeon.body":
    "Make a 집현전 from the home screen and drop your sources in, or put files in its 자료 folder in Explorer.\nAnswers cite sources such as [file · page 3]; click one to open the file.\nWhat the sources do not say is answered as not in the sources, and you are asked before the web is searched.\nScanned pages without text cannot be searched; the sources list marks them.",
  "guide.skills.title": "Skills",
  "guide.skills.body":
    "Skills are know-how for particular tasks. The document skills are on; the others are installed but off, and the AI offers to turn one on when you need it.\nSee, search and switch skills in Session details → Context → Skills, or in Settings → Preferences → Bundled skills.\nType @ in the composer to call any skill, even one that is off.",
  "guide.safety.title": "Safety and permission",
  "guide.safety.body":
    "Before the AI changes a file outside the workroom, or deletes or moves files, you are asked. Allow once, or always for this workroom.\nIf you refuse, the AI stops instead of finding another way, and tells you how to do it yourself.\nWhat you ask and the files the AI reads go to the company of the model you chose; check sensitive material first.",
  "guide.more.title": "More",
  "guide.more.body":
    "Attach a recording or video to have it transcribed with times and speakers; turn it on in Settings → Preferences → Transcription.\nCosts show in won. The donut in Session details shows how much of the context each part uses.\nWhen something fails, follow the advice under the error, or send a report.",
}
