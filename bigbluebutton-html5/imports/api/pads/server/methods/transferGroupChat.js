import axios from "axios";
import { Meteor } from "meteor/meteor";
import { GroupChatMsg } from "/imports/api/group-chat-msg";
import User from "/imports/api/users";
import Logger from "/imports/startup/server/logger";

const transferGroupChat = async (meetingId) => {
  try {
    const messages = GroupChatMsg.find({ meetingId });
    const formattedMessages = messages.map((message) => ({
      meeting_id: meetingId,
      chat_id: message.chatId,
      sender_id: message.sender,
      sender_name: User.findOne({ userId: message.sender, meetingId }).name,
      message: message.message,
    }));

    const response = await axios.post(
      `${Meteor.settings.public.app.pushMessageUrl}/classes/messages`,
      {
        messages: formattedMessages,
      }
    );

    if (response.status === 200 && response.data.status) {
      Logger.info(`Transferred GroupChat (${meetingId})`);
    } else {
      throw Error("An issue occurred on server side!");
    }
  } catch (err) {
    Logger.error(`Error on transferring GroupChat (${meetingId}). ${err}`);
  }
};

export default transferGroupChat;
