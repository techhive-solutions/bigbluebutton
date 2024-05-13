import GroupChat from "/imports/api/group-chat";
import clearGroupChatMsg from "/imports/api/group-chat-msg/server/modifiers/clearGroupChatMsg";
import transferGroupChat from "/imports/api/pads/server/methods/transferGroupChat";
import Logger from "/imports/startup/server/logger";

export default async function clearGroupChat(meetingId) {
  try {
    // ? Custom Change: Before clearing the GroupChat, transfer the GroupChat to external service
    // This is to ensure that the chat data is not lost & can be utilized for future references
    await transferGroupChat(meetingId);

    await clearGroupChatMsg(meetingId);
    const numberAffected = await GroupChat.removeAsync({ meetingId });

    if (numberAffected) {
      Logger.info(`Cleared GroupChat (${meetingId})`);
    }
  } catch (err) {
    Logger.error(`Error on clearing GroupChat (${meetingId}). ${err}`);
  }
}
