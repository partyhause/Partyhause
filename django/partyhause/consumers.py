from channels.generic.websocket import AsyncWebsocketConsumer
import json

class PartyConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.accept()
        self.room_name = self.scope['url_route']['kwargs']['room']
        await self.channel_layer.group_add(self.room_name, self.channel_name)

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_name, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        await self.channel_layer.group_send(
            self.room_name,
            {'type': 'party.message', 'message': data}
        )

    async def party_message(self, event):
        await self.send(text_data=json.dumps(event['message']))
