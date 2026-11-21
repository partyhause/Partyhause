from django.test import TestCase
from channels.testing import WebsocketCommunicator
from partyhause.consumers import PartyConsumer

class ChannelsTests(TestCase):
    async def test_websocket_connect(self):
        communicator = WebsocketCommunicator(PartyConsumer.as_asgi(), "/ws/party/room1/")
        connected, subprotocol = await communicator.connect()
        self.assertTrue(connected)
        await communicator.disconnect()

    async def test_websocket_message_broadcast(self):
        communicator1 = WebsocketCommunicator(PartyConsumer.as_asgi(), "/ws/party/room1/")
        communicator2 = WebsocketCommunicator(PartyConsumer.as_asgi(), "/ws/party/room1/")
        await communicator1.connect()
        await communicator2.connect()
        
        await communicator1.send_json_to({"message": "hello"})
        response = await communicator2.receive_json_from()
        self.assertEqual(response, {"message": "hello"})
        
        await communicator1.disconnect()
        await communicator2.disconnect()
